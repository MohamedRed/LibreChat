import { expect, test, type APIRequestContext, type Frame, type Page } from '@playwright/test';
import { readSmokeIdentity } from '../setup/smoke.shared';

const TARGET_SITE = 'https://example.com/';
const WIDGET_BASE = (
  process.env.E2E_WIDGET_FRAME_BASE_URL ||
  process.env.E2E_BASE_URL ||
  'https://liive.app'
)
  .trim()
  .replace(/\/+$/, '');
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
        if (status === 'succeeded') {
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
  return body as { site_key: string };
}

async function mountLoaderOnHostPage(page: Page, siteKey: string) {
  await page.goto(TARGET_SITE, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.addScriptTag({
    content: `window.LiiveWidget = ${JSON.stringify({ siteKey, baseUrl: WIDGET_BASE })};`,
  });
  await page.addScriptTag({ url: `${WIDGET_BASE}/widget/v1/loader.js` });

  await expect(page.locator('#liive-widget-root')).toHaveAttribute('data-state', 'closed');
  await expect(page.locator('#liive-widget-launcher')).toBeVisible();
}

async function getWidgetFrame(page: Page): Promise<Frame> {
  await expect
    .poll(() => Boolean(page.frame({ url: /\/widget\/v1\/frame/i })), {
      timeout: 60_000,
      intervals: [1_000, 2_000, 5_000],
    })
    .toBeTruthy();
  const frame = page.frame({ url: /\/widget\/v1\/frame/i });
  if (!frame) {
    throw new Error('Widget frame not found');
  }
  return frame;
}

test.describe('Production smoke widget overlay', () => {
  test('compact/expand/collapse/close flow keeps chat working and rejects forged postMessage', async ({
    page,
  }) => {
    const identity = readSmokeIdentity();
    const authToken = identity?.authToken;
    expect(authToken).toBeTruthy();

    await configureSite(page.request, String(authToken));
    const jobId = await runCrawl(page.request, String(authToken));
    await waitForCrawlSuccess(page.request, jobId, String(authToken));

    const widget = await getWidgetConfig(page.request, String(authToken));
    await mountLoaderOnHostPage(page, widget.site_key);

    const root = page.locator('#liive-widget-root');
    const launcher = page.locator('#liive-widget-launcher');
    const panel = page.locator('#liive-widget-panel');
    const backdrop = page.locator('#liive-widget-backdrop');

    await launcher.click();
    await expect(root).toHaveAttribute('data-state', 'compact');

    const viewport = page.viewportSize();
    expect(viewport).toBeTruthy();
    const compactBox = await panel.boundingBox();
    expect(compactBox).toBeTruthy();
    if (!viewport || !compactBox) {
      throw new Error('Missing viewport/panel metrics in compact mode');
    }
    expect(compactBox.width).toBeGreaterThan(320);
    expect(compactBox.width).toBeLessThan(390);
    const expectedCompactHeight = Math.min(560, viewport.height - 96);
    expect(compactBox.height).toBeGreaterThanOrEqual(expectedCompactHeight - 16);
    expect(compactBox.height).toBeLessThanOrEqual(expectedCompactHeight + 16);

    const frame = await getWidgetFrame(page);
    await frame.locator('#message-input').waitFor({ state: 'visible', timeout: 60_000 });

    await frame.evaluate(() => {
      window.parent.postMessage({ type: 'liive-widget:resize', height: 640, version: 'v1' }, '*');
    });

    await expect
      .poll(async () => {
        const box = await page.locator('#liive-widget-panel').boundingBox();
        return box?.height ?? 0;
      })
      .toBeGreaterThan(Math.min(640, viewport.height - 96) - 20);

    await frame.locator('#toggle-expand-btn').click();
    await expect(root).toHaveAttribute('data-state', 'expanded');

    await expect(backdrop).toBeVisible();
    await expect
      .poll(async () =>
        page.evaluate(() => ({
          html: getComputedStyle(document.documentElement).overflow,
          body: getComputedStyle(document.body).overflow,
        })),
      )
      .toEqual({ html: 'hidden', body: 'hidden' });

    const expandedBox = await panel.boundingBox();
    expect(expandedBox).toBeTruthy();
    if (!expandedBox) {
      throw new Error('Missing expanded panel metrics');
    }
    expect(expandedBox.x).toBeGreaterThanOrEqual(20);
    expect(expandedBox.y).toBeGreaterThanOrEqual(20);
    expect(expandedBox.width).toBeGreaterThanOrEqual(viewport.width - 70);
    expect(expandedBox.height).toBeGreaterThanOrEqual(viewport.height - 70);

    await frame.evaluate(() => {
      window.parent.postMessage({ type: 'liive-widget:resize', height: 320, version: 'v1' }, '*');
    });

    await page.waitForTimeout(300);
    const expandedBoxAfterResize = await panel.boundingBox();
    expect(expandedBoxAfterResize).toBeTruthy();
    if (!expandedBoxAfterResize) {
      throw new Error('Missing expanded panel metrics after resize');
    }
    expect(Math.abs(expandedBoxAfterResize.height - expandedBox.height)).toBeLessThan(10);

    await backdrop.click();
    await expect(root).toHaveAttribute('data-state', 'compact');

    await frame.locator('#toggle-expand-btn').click();
    await expect(root).toHaveAttribute('data-state', 'expanded');

    await frame.locator('#message-input').fill('What is this website about? Cite one source URL.');
    await frame.locator('#send-btn').click();

    await expect
      .poll(
        async () => {
          return (await frame.locator('#messages').innerText()) || '';
        },
        {
          timeout: 120_000,
          intervals: [2_000, 5_000, 10_000],
        },
      )
      .toMatch(new RegExp(`example\\.com|${WIDGET_NO_CONTEXT_PATTERN.source}`, 'i'));

    await page.keyboard.press('Escape');
    await expect(root).toHaveAttribute('data-state', 'compact');
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const html = getComputedStyle(document.documentElement).overflow;
          const body = getComputedStyle(document.body).overflow;
          return html !== 'hidden' && body !== 'hidden';
        }),
      )
      .toBeTruthy();

    await frame.locator('#close-btn').click();
    await expect(root).toHaveAttribute('data-state', 'closed');

    await launcher.click();
    await expect(root).toHaveAttribute('data-state', 'compact');

    await page.evaluate(() => {
      window.postMessage({ type: 'liive-widget:expand', version: 'v1' }, '*');
    });

    await page.waitForTimeout(300);
    await expect(root).toHaveAttribute('data-state', 'compact');
  });

  test('mobile expanded mode uses fullscreen inset 0', async ({ page }) => {
    const identity = readSmokeIdentity();
    const authToken = identity?.authToken;
    expect(authToken).toBeTruthy();

    await configureSite(page.request, String(authToken));
    const widget = await getWidgetConfig(page.request, String(authToken));

    await page.setViewportSize({ width: 390, height: 844 });
    await mountLoaderOnHostPage(page, widget.site_key);

    await page.locator('#liive-widget-launcher').click();
    await expect(page.locator('#liive-widget-root')).toHaveAttribute('data-state', 'compact');

    const frame = await getWidgetFrame(page);
    await frame.locator('#toggle-expand-btn').click();
    await expect(page.locator('#liive-widget-root')).toHaveAttribute('data-state', 'expanded');

    const viewport = page.viewportSize();
    expect(viewport).toBeTruthy();
    const expandedBox = await page.locator('#liive-widget-panel').boundingBox();
    expect(expandedBox).toBeTruthy();
    if (!viewport || !expandedBox) {
      throw new Error('Missing mobile panel metrics');
    }

    expect(Math.abs(expandedBox.x)).toBeLessThan(1.5);
    expect(Math.abs(expandedBox.y)).toBeLessThan(1.5);
    expect(Math.abs(expandedBox.width - viewport.width)).toBeLessThan(2.5);
    expect(Math.abs(expandedBox.height - viewport.height)).toBeLessThan(2.5);
  });
});
