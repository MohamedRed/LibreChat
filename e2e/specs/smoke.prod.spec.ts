import { expect, test, type Page } from '@playwright/test';

const TARGET_SITE = 'https://httpbin.org/';

async function openWebsiteSettings(page: Page) {
  await page.getByTestId('nav-user').click();
  const settingsOption = page.getByRole('option', { name: /settings|param[eè]tres/i });
  await expect(settingsOption).toBeVisible({ timeout: 30_000 });
  await settingsOption.click();
  await page.getByRole('tab', { name: /website|site/i }).click();
}

async function waitForCrawlSuccess(page: Page) {
  const statusLocator = page.getByTestId('tenant-crawl-status');
  await expect.poll(
    async () => {
      const text = await statusLocator.innerText();
      const normalized = text.toLowerCase();
      if (normalized.includes('failed')) {
        return 'failed';
      }
      if (normalized.includes('succeeded')) {
        return 'succeeded';
      }
      if (normalized.includes('running')) {
        return 'running';
      }
      if (normalized.includes('queued')) {
        return 'queued';
      }
      if (normalized.includes('ingesting')) {
        return 'ingesting';
      }
      return 'unknown';
    },
    {
      timeout: 10 * 60_000,
      intervals: [5_000, 10_000, 15_000],
      message: 'Crawl did not reach succeeded state in time',
    },
  ).toBe('succeeded');
}

test.describe('Production smoke', () => {
  test('signup user can run crawl and get grounded answer with citation', async ({ page }) => {
    await page.goto('/c/new', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('nav-user')).toBeVisible({ timeout: 60_000 });
    await openWebsiteSettings(page);

    await page.getByTestId('tenant-site-base').fill(TARGET_SITE);
    await page.getByTestId('tenant-site-sitemap').fill('');
    await page.getByTestId('tenant-site-save').click();

    await page.getByTestId('tenant-site-run-crawl').click();
    await waitForCrawlSuccess(page);

    await page.keyboard.press('Escape');
    await page.getByTestId('text-input').waitFor({ state: 'visible', timeout: 30_000 });
    await page.getByTestId('text-input').fill('What is this service used for? Cite sources.');
    await page.getByTestId('send-button').click();

    const citationLink = page.locator('a[href*="httpbin.org"]').first();
    await expect(citationLink).toBeVisible({ timeout: 180_000 });

    const pageText = (await page.locator('main').innerText()).toLowerCase();
    expect(pageText).not.toMatch(
      /je ne sais pas|i don't know|cannot access external|n'ai pas acc[eè]s [àa] des sites externes|sources index[eé]es ne contiennent/i,
    );
  });
});
