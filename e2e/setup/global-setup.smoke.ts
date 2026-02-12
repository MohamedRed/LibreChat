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
    const registerResponse = await context.request.post(`${baseURL}/api/auth/register`, {
      data: {
        name: 'E2E Smoke',
        company_name: identity.companyName,
        subdomain: identity.subdomain,
        email: identity.email,
        password: identity.password,
        confirm_password: identity.password,
      },
      timeout: 60_000,
    });

    if (!registerResponse.ok()) {
      throw new Error(
        `Smoke setup register failed with status=${registerResponse.status()} body=${await registerResponse.text()}`,
      );
    }

    await page.goto(`${baseURL}/login`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.getByTestId('email').fill(identity.email);
    await page.getByTestId('password').fill(identity.password);
    await page.getByRole('button', { name: 'Continue' }).click();

    await page.waitForURL(/\/c\/new$/, { timeout: 120_000 });
    await page.getByTestId('nav-user').waitFor({ state: 'visible', timeout: 30_000 });
    await context.storageState({ path: smokeStorageStatePath });
  } finally {
    await context.close();
    await browser.close();
  }
}

export default globalSetup;
