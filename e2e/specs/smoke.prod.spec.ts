import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { readSmokeIdentity } from '../setup/smoke.shared';

const TARGET_SITE = 'https://example.com/';
const TARGET_DOMAIN = 'example.com';

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
        return String(body?.status ?? '').toLowerCase();
      },
      {
        timeout: 10 * 60_000,
        intervals: [5_000, 10_000, 15_000],
        message: 'Crawl did not reach succeeded state in time',
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
    await page.getByTestId('text-input').waitFor({ state: 'visible', timeout: 30_000 });
    await page.getByTestId('text-input').fill('What is this website about? Cite source URLs.');
    await page.getByTestId('send-button').click();

    const citationLink = page.locator(`a[href*="${TARGET_DOMAIN}"]`).first();
    await expect(citationLink).toBeVisible({ timeout: 180_000 });

    const pageText = (await page.locator('main').innerText()).toLowerCase();
    expect(pageText).not.toMatch(
      /je ne sais pas|i don't know|cannot access external|n'ai pas acc[eè]s [àa] des sites externes|sources index[eé]es ne contiennent/i,
    );
  });
});
