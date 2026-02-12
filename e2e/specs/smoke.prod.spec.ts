import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { readSmokeIdentity } from '../setup/smoke.shared';

const TARGET_SITE = 'https://example.com/';
const TARGET_DOMAIN = 'example.com';
const CHAT_API_PATH = '/api/agents/chat/agents';

async function configureSite(request: APIRequestContext, authToken: string) {
  const saveResponse = await request.post('/api/tenant/site', {
    headers: { Authorization: `Bearer ${authToken}` },
    data: {
      base_url: TARGET_SITE,
      sitemap_url: null,
      crawl_rules: {
        max_urls: 1,
      },
    },
  });
  expect(saveResponse.ok()).toBeTruthy();
}

async function runCrawl(request: APIRequestContext, authToken: string): Promise<number> {
  const runResponse = await request.post('/api/tenant/crawl', {
    headers: { Authorization: `Bearer ${authToken}` },
    data: { full: true },
  });
  expect(runResponse.ok()).toBeTruthy();
  const body = await runResponse.json();
  expect(typeof body?.job_id).toBe('number');
  return body.job_id as number;
}

async function waitForCrawlSuccess(request: APIRequestContext, jobId: number, authToken: string) {
  await expect
    .poll(
      async () => {
        const statusResponse = await request.get(`/api/tenant/crawl/status/${jobId}`, {
          headers: { Authorization: `Bearer ${authToken}` },
        });
        if (!statusResponse.ok()) {
          return 'failed';
        }
        const body = await statusResponse.json();
        const status = String(body?.status ?? '').toLowerCase();
        const ingested = Number(body?.stats?.ingested ?? 0);
        if (status === 'succeeded' && ingested > 0) {
          return 'succeeded';
        }
        if (status === 'failed' || status === 'cancelled') {
          return 'failed';
        }
        return 'running';
      },
      {
        timeout: 10 * 60_000,
        intervals: [5_000, 10_000, 15_000],
        message: 'Crawl did not reach succeeded + ingested>0 state in time',
      },
    )
    .toBe('succeeded');
}

test.describe('Production smoke', () => {
  test('signup user can run crawl and get grounded answer with citation', async ({ page }) => {
    const identity = readSmokeIdentity();
    const authToken = identity?.authToken;
    expect(authToken).toBeTruthy();
    await configureSite(page.request, String(authToken));
    const jobId = await runCrawl(page.request, String(authToken));
    await waitForCrawlSuccess(page.request, jobId, String(authToken));

    await page.goto('/c/new', { waitUntil: 'domcontentloaded' });
    const endpointMenu = page.locator('#new-conversation-menu');
    if (await endpointMenu.isVisible()) {
      await endpointMenu.click();
      const googleEndpoint = page.locator('#google').first();
      if (await googleEndpoint.isVisible()) {
        await googleEndpoint.click();
      }
    }

    await page.getByTestId('text-input').waitFor({ state: 'visible', timeout: 30_000 });
    await page
      .getByTestId('text-input')
      .fill(
        'Using only indexed site content, what is this website about? Include at least one source URL from the site in your answer.',
      );
    await expect(page.getByTestId('send-button')).toBeEnabled({ timeout: 10_000 });

    const generationResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' && response.url().includes(CHAT_API_PATH),
      { timeout: 60_000 },
    );
    await page.getByTestId('send-button').click();
    const generationResponse = await generationResponsePromise;
    const generationBody = await generationResponse.text();
    expect(generationResponse.status(), `Generation request failed: ${generationBody}`).toBe(200);

    const main = page.locator('main');
    let pageText = '';
    await expect
      .poll(
        async () => {
          pageText = (await main.innerText()).toLowerCase();
          return pageText;
        },
        {
          timeout: 180_000,
          intervals: [2_000, 5_000, 10_000],
          message: 'Assistant response did not include a source URL from the crawled site',
        },
      )
      .toContain(TARGET_DOMAIN);

    expect(pageText).not.toMatch(
      /je ne sais pas|i don't know|cannot access external|n'ai pas acc[eè]s [àa] des sites externes|sources index[eé]es ne contiennent/i,
    );
  });
});
