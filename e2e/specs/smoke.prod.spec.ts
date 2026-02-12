import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const TARGET_SITE = 'https://example.com/';
const TARGET_DOMAIN = 'example.com';

async function configureSite(request: APIRequestContext) {
  const saveResponse = await request.post('/api/tenant/site', {
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

async function runCrawl(request: APIRequestContext): Promise<number> {
  const runResponse = await request.post('/api/tenant/crawl', { data: { full: true } });
  expect(runResponse.ok()).toBeTruthy();
  const body = await runResponse.json();
  expect(typeof body?.job_id).toBe('number');
  return body.job_id as number;
}

async function waitForCrawlSuccess(request: APIRequestContext, jobId: number) {
  await expect
    .poll(
      async () => {
        const statusResponse = await request.get(`/api/tenant/crawl/status/${jobId}`);
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
    await configureSite(page.request);
    const jobId = await runCrawl(page.request);
    await waitForCrawlSuccess(page.request, jobId);

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
