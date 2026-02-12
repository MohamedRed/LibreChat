import { FullConfig, chromium } from '@playwright/test';
import {
  buildSmokeIdentity,
  smokeStorageStatePath,
  writeSmokeIdentity,
} from './smoke.shared';

async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = String(config.projects[0]?.use?.baseURL || process.env.E2E_BASE_URL || '').trim();
  if (!baseURL) {
    throw new Error('Missing E2E_BASE_URL (or baseURL in Playwright config)');
  }

  const identity = buildSmokeIdentity(baseURL);
  writeSmokeIdentity(identity);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto(`${baseURL}/register`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.getByTestId('name').fill('E2E Smoke');
    await page.getByTestId('company_name').fill(identity.companyName);
    await page.getByTestId('subdomain').fill(identity.subdomain);
    await page.getByTestId('email').fill(identity.email);
    await page.getByTestId('password').fill(identity.password);
    await page.getByTestId('confirm_password').fill(identity.password);

    const hasTurnstile = (await page.locator('.cf-turnstile, iframe[src*="turnstile"]').count()) > 0;
    if (hasTurnstile) {
      throw new Error('Turnstile captcha is enabled; disable it for smoke CI users or add a bypass.');
    }

    await page.getByRole('button', { name: 'Submit registration' }).click();

    await Promise.race([
      page.waitForURL(/\/c\/new$/, { timeout: 120_000 }),
      page.waitForURL(/checkout\.stripe\.com/, { timeout: 120_000 }),
    ]);

    if (/checkout\.stripe\.com/i.test(page.url())) {
      throw new Error('Signup redirected to Stripe checkout. Smoke tests require direct app access after signup.');
    }

    await page.getByTestId('nav-user').waitFor({ state: 'visible', timeout: 30_000 });
    await context.storageState({ path: smokeStorageStatePath });
  } finally {
    await context.close();
    await browser.close();
  }
}

export default globalSetup;
