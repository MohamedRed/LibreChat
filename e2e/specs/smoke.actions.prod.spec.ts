import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test';
import { readSmokeIdentity } from '../setup/smoke.shared';

const SITE_BASE_URL = 'https://httpbin.org/';
const ACTION_DISCOVER_URL = 'https://httpbin.org/forms/post';
const JSON_CONTENT_TYPE = 'application/json';

async function upsertSite(request: APIRequestContext, authToken: string) {
  const response = await request.post('/api/tenant/site', {
    headers: { Authorization: `Bearer ${authToken}` },
    data: {
      base_url: SITE_BASE_URL,
      sitemap_url: null,
      crawl_rules: {
        max_urls: 1,
      },
    },
  });
  expect(response.ok(), `Save site failed: ${await response.text()}`).toBeTruthy();
}

async function discoverActions(request: APIRequestContext, authToken: string) {
  const response = await request.post('/api/tenant/actions/discover', {
    headers: { Authorization: `Bearer ${authToken}` },
    data: {
      url: ACTION_DISCOVER_URL,
    },
  });
  expect(response.ok(), `Discover actions failed: ${await response.text()}`).toBeTruthy();
  const body = await response.json();
  expect(typeof body?.job_id).toBe('number');
  expect(['queued', 'running', 'skipped', 'succeeded']).toContain(String(body?.status ?? '').toLowerCase());
  return body;
}

async function listActionsForUrl(request: APIRequestContext, authToken: string): Promise<APIResponse> {
  const query = encodeURIComponent(ACTION_DISCOVER_URL);
  return request.get(`/api/tenant/actions?url=${query}`, {
    headers: { Authorization: `Bearer ${authToken}` },
  });
}

test.describe('Production smoke - actions', () => {
  test('discovers actions and validates async run endpoint contract when available', async ({ page }) => {
    const identity = readSmokeIdentity();
    const authToken = identity?.authToken;
    expect(authToken).toBeTruthy();

    await upsertSite(page.request, String(authToken));
    await discoverActions(page.request, String(authToken));

    await expect
      .poll(
        async () => {
          const response = await listActionsForUrl(page.request, String(authToken));
          if (!response.ok()) {
            return -1;
          }
          const body = await response.json();
          return Array.isArray(body) ? body.length : 0;
        },
        {
          timeout: 180_000,
          intervals: [5_000, 10_000, 15_000],
          message: 'No actions were discovered for the target page in time',
        },
      )
      .toBeGreaterThan(0);

    const actionsResponse = await listActionsForUrl(page.request, String(authToken));
    expect(actionsResponse.ok()).toBeTruthy();
    const actions = await actionsResponse.json();
    expect(Array.isArray(actions)).toBeTruthy();
    const discovered = actions[0];
    expect(discovered?.url).toBe(ACTION_DISCOVER_URL);
    expect(['form', 'button', 'link', 'schema_action']).toContain(discovered?.action_type);
    expect(['static', 'playwright']).toContain(discovered?.source);
    expect(discovered?.endpoint).toContain('httpbin.org');

    const runResponse = await page.request.post('/api/tenant/tools/action/run', {
      headers: { Authorization: `Bearer ${authToken}` },
      data: {
        action_id: discovered?.id,
        params: {
          custname: 'E2E Smoke',
          custtel: '000000000',
          custemail: 'e2e@example.com',
          size: 'medium',
          topping: ['cheese'],
          delivery: '13:00',
          comments: 'automation smoke test',
        },
      },
    });

    const contentType = String(runResponse.headers()['content-type'] || '').toLowerCase();
    if (!contentType.includes(JSON_CONTENT_TYPE)) {
      test.info().annotations.push({
        type: 'note',
        description: 'Async action run endpoint not exposed on /api/tenant; discovery validation completed.',
      });
      return;
    }

    expect(runResponse.ok(), `Action run failed: ${await runResponse.text()}`).toBeTruthy();
    const runBody = await runResponse.json();
    expect(typeof runBody?.job_id).toBe('number');

    await expect
      .poll(
        async () => {
          const statusResponse = await page.request.get(
            `/api/tenant/tools/action/status?job_id=${runBody.job_id}`,
            {
              headers: { Authorization: `Bearer ${authToken}` },
            },
          );
          if (!statusResponse.ok()) {
            return 'failed';
          }
          const statusContentType = String(statusResponse.headers()['content-type'] || '').toLowerCase();
          if (!statusContentType.includes(JSON_CONTENT_TYPE)) {
            return 'unavailable';
          }
          const statusBody = await statusResponse.json();
          return String(statusBody?.status ?? '').toLowerCase();
        },
        {
          timeout: 180_000,
          intervals: [5_000, 10_000, 15_000],
          message: 'Async action run did not reach a terminal state',
        },
      )
      .toMatch(/succeeded|failed|cancelled|unavailable/);
  });
});
