import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { readSmokeIdentity } from '../setup/smoke.shared';

const TARGET_SITE = 'https://example.com/';
const FRAME_BASE_OVERRIDE = process.env.E2E_WIDGET_FRAME_BASE_URL?.trim();
const WIDGET_NO_CONTEXT_PATTERN =
  /pas assez d'informations|not enough information|insufficient context|je ne sais pas/i;

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
      },
    )
    .toBe('succeeded');
}

async function getWidgetConfig(request: APIRequestContext, authToken: string) {
  const response = await request.get('/api/tenant/widget/config', {
    headers: { Authorization: `Bearer ${authToken}` },
  });
  expect(response.ok()).toBeTruthy();
  const body = await response.json();
  expect(body?.site_key).toBeTruthy();
  return body as { site_key: string; frame_url?: string };
}

async function chatInFrame(page: Page, frameUrl: string) {
  await page.goto(frameUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.locator('#message-input').waitFor({ state: 'visible', timeout: 60_000 });
  await expect
    .poll(async () => ((await page.locator('#messages').innerText()) || '').toLowerCase(), {
      timeout: 60_000,
      intervals: [1_000, 2_000, 5_000],
    })
    .toContain('bonjour');
  await page.locator('#message-input').fill('What is this website about? Cite one source URL.');
  await page.locator('#send-btn').click();
  await expect
    .poll(async () => (await page.locator('#messages').innerText()) || '', {
      timeout: 120_000,
      intervals: [2_000, 5_000, 10_000],
    })
    .toMatch(new RegExp(`example\\.com|${WIDGET_NO_CONTEXT_PATTERN.source}`, 'i'));
}

test.describe('Production smoke widget', () => {
  test('tenant can use embedded widget frame with grounded citation', async ({ page }) => {
    const identity = readSmokeIdentity();
    const authToken = identity?.authToken;
    expect(authToken).toBeTruthy();

    await configureSite(page.request, String(authToken));
    const jobId = await runCrawl(page.request, String(authToken));
    await waitForCrawlSuccess(page.request, jobId, String(authToken));

    const widget = await getWidgetConfig(page.request, String(authToken));
    const frameBase = FRAME_BASE_OVERRIDE
      ? `${FRAME_BASE_OVERRIDE.replace(/\/+$/, '')}/widget/v1/frame`
      : widget.frame_url ?? '/widget/v1/frame';
    const frameUrl =
      `${frameBase}?site_key=${encodeURIComponent(widget.site_key)}` +
      `&origin_host=example.com&page_url=${encodeURIComponent(TARGET_SITE)}`;
    await chatInFrame(page, frameUrl);
  });
});
