import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { readSmokeIdentity } from '../setup/smoke.shared';

const SITE_A = 'https://example.com/';
const DOMAIN_A = 'example.com';
const SITE_B = 'https://httpbin.org/';
const DOMAIN_B = 'httpbin.org';
const CHAT_API_PATH_PREFIX = '/api/agents/chat/';
const NO_CONTEXT_PATTERN =
  /je ne sais pas|i don't know|cannot access external|n'ai pas acc[eè]s [àa] des sites externes|sources index[eé]es ne contiennent/i;

async function ensureUiSession(page: Page, email: string, password: string) {
  const loginResponse = await page.context().request.post('/api/auth/login', {
    data: { email, password },
    timeout: 60_000,
  });
  expect(loginResponse.ok(), `UI login failed: ${await loginResponse.text()}`).toBeTruthy();
  await page.goto('/c/new', { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForURL(/\/c\/new$/, { timeout: 120_000 });
  await page.getByTestId('nav-user').waitFor({ state: 'visible', timeout: 30_000 });
}

type TenantIdentity = {
  email: string;
  password: string;
  companyName: string;
  subdomain: string;
};

function envRequired(name: string): string {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value.trim();
}

function buildSecondaryIdentity(): TenantIdentity {
  const emailDomain = envRequired('E2E_EMAIL_DOMAIN').replace(/^@+/, '').trim().toLowerCase();
  const password = envRequired('E2E_PASSWORD');
  const suffix = Date.now().toString(36);
  return {
    email: `e2e+b-${suffix}@${emailDomain}`,
    password,
    companyName: `E2E B ${suffix}`,
    subdomain: `e2e-b-${suffix}`.slice(0, 63),
  };
}

async function registerAndLogin(
  context: BrowserContext,
  request: APIRequestContext,
  baseURL: string,
  identity: TenantIdentity,
): Promise<string> {
  const registerResponse = await request.post(`${baseURL}/api/auth/register`, {
    data: {
      name: 'E2E Smoke B',
      company_name: identity.companyName,
      subdomain: identity.subdomain,
      email: identity.email,
      password: identity.password,
      confirm_password: identity.password,
    },
    timeout: 60_000,
  });
  expect(registerResponse.ok(), `Register failed: ${await registerResponse.text()}`).toBeTruthy();

  const loginResponse = await request.post(`${baseURL}/api/auth/login`, {
    data: {
      email: identity.email,
      password: identity.password,
    },
    timeout: 60_000,
  });
  expect(loginResponse.ok(), `Login failed: ${await loginResponse.text()}`).toBeTruthy();
  const loginBody = await loginResponse.json().catch(() => ({}));
  const token = loginBody?.token;
  expect(token).toBeTruthy();

  const page = await context.newPage();
  await page.goto(`${baseURL}/c/new`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.getByTestId('nav-user').waitFor({ state: 'visible', timeout: 30_000 });
  await page.close();

  return String(token);
}

async function configureSite(request: APIRequestContext, authToken: string, baseUrl: string) {
  const saveResponse = await request.post('/api/tenant/site', {
    headers: { Authorization: `Bearer ${authToken}` },
    data: {
      base_url: baseUrl,
      sitemap_url: null,
      crawl_rules: {
        max_urls: 1,
      },
    },
  });
  expect(saveResponse.ok(), `Save site failed: ${await saveResponse.text()}`).toBeTruthy();
}

async function runCrawl(request: APIRequestContext, authToken: string): Promise<number> {
  const runResponse = await request.post('/api/tenant/crawl', {
    headers: { Authorization: `Bearer ${authToken}` },
    data: { full: true },
  });
  expect(runResponse.ok(), `Run crawl failed: ${await runResponse.text()}`).toBeTruthy();
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

async function askThroughUiAndGetStreamBody(page: Page, prompt: string): Promise<string> {
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
  await page.getByTestId('text-input').fill(prompt);
  await expect(page.getByTestId('send-button')).toBeEnabled({ timeout: 10_000 });

  const generationResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().includes(CHAT_API_PATH_PREFIX),
    { timeout: 90_000 },
  );
  await page.getByTestId('send-button').click();
  const generationResponse = await generationResponsePromise;
  const generationBody = await generationResponse.text();
  expect(generationResponse.status(), `Generation request failed: ${generationBody}`).toBe(200);

  const generationStart = JSON.parse(generationBody) as { streamId?: string; status?: string };
  expect(generationStart.status).toBe('started');
  expect(typeof generationStart.streamId).toBe('string');
  expect(generationStart.streamId?.length).toBeGreaterThan(0);

  const streamResponse = await page.waitForResponse(
    (response) =>
      response.request().method() === 'GET' &&
      response.url().includes(`/api/agents/chat/stream/${generationStart.streamId}`),
    { timeout: 120_000 },
  );
  expect(streamResponse.status()).toBe(200);
  const streamBody = (await streamResponse.text()).toLowerCase();
  expect(streamBody).toContain('"final":true');
  expect(streamBody).not.toMatch(/internal server error|traceback|request failed with status code 5\d\d/i);
  return streamBody;
}

async function deleteTenantUser(
  browser: Browser,
  baseURL: string,
  identity: TenantIdentity,
): Promise<void> {
  const tempContext = await browser.newContext();
  try {
    const loginResponse = await tempContext.request.post(`${baseURL}/api/auth/login`, {
      data: {
        email: identity.email,
        password: identity.password,
      },
      timeout: 60_000,
    });
    if (!loginResponse.ok()) {
      return;
    }
    const loginBody = await loginResponse.json().catch(() => ({}));
    const token = loginBody?.token;
    if (!token) {
      return;
    }
    const deleteResponse = await tempContext.request.delete(`${baseURL}/api/user/delete`, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 60_000,
    });
    expect(deleteResponse.ok(), `Tenant B teardown failed: ${await deleteResponse.text()}`).toBeTruthy();
  } finally {
    await tempContext.close();
  }
}

test.describe('Production smoke - tenant isolation', () => {
  test('tenant A never receives tenant B domain and vice versa', async ({ page, browser }) => {
    const globalIdentity = readSmokeIdentity();
    const baseURL = String(globalIdentity?.baseURL || process.env.E2E_BASE_URL || '').trim();
    expect(baseURL).toBeTruthy();

    const tokenA = globalIdentity?.authToken;
    expect(tokenA).toBeTruthy();
    expect(globalIdentity?.email).toBeTruthy();
    expect(globalIdentity?.password).toBeTruthy();

    await configureSite(page.request, String(tokenA), SITE_A);
    const jobA = await runCrawl(page.request, String(tokenA));
    await waitForCrawlSuccess(page.request, jobA, String(tokenA));
    await ensureUiSession(page, String(globalIdentity?.email), String(globalIdentity?.password));

    const streamA = await askThroughUiAndGetStreamBody(
      page,
      'Using only indexed site content, provide one source URL from the site in your answer.',
    );
    expect(streamA).not.toContain(DOMAIN_B);
    expect(streamA).toMatch(new RegExp(`${DOMAIN_A}|${NO_CONTEXT_PATTERN.source}`));

    let contextB: BrowserContext | null = null;
    const identityB = buildSecondaryIdentity();
    try {
      contextB = await (browser as Browser).newContext({ baseURL });
      const tokenB = await registerAndLogin(contextB, contextB.request, baseURL, identityB);

      await configureSite(contextB.request, tokenB, SITE_B);
      const jobB = await runCrawl(contextB.request, tokenB);
      await waitForCrawlSuccess(contextB.request, jobB, tokenB);

      const pageB = await contextB.newPage();
      const streamB = await askThroughUiAndGetStreamBody(
        pageB,
        'Using only indexed site content, provide one source URL from the site in your answer.',
      );
      await pageB.close();

      expect(streamB).not.toContain(DOMAIN_A);
      expect(streamB).toMatch(new RegExp(`${DOMAIN_B}|${NO_CONTEXT_PATTERN.source}`));
    } finally {
      if (contextB) {
        await contextB.close();
      }
      await deleteTenantUser(browser, baseURL, identityB);
    }
  });
});
