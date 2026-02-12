import fs from 'fs';
import path from 'path';
import { chromium } from '@playwright/test';
import {
  ensureSmokeArtifactsDir,
  readSmokeIdentity,
  smokeStorageStatePath,
} from './smoke.shared';

async function globalTeardown(): Promise<void> {
  const identity = readSmokeIdentity();
  if (!identity) {
    return;
  }

  ensureSmokeArtifactsDir();
  const resultPath = path.resolve(process.cwd(), 'e2e/.artifacts/smoke-teardown.json');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    baseURL: identity.baseURL,
    storageState: fs.existsSync(smokeStorageStatePath) ? smokeStorageStatePath : undefined,
  });

  try {
    const loginResponse = await context.request.post(`${identity.baseURL}/api/auth/login`, {
      data: {
        email: identity.email,
        password: identity.password,
      },
      timeout: 60_000,
    });
    if (!loginResponse.ok()) {
      throw new Error(`Smoke teardown login failed: ${loginResponse.status()}`);
    }
    const loginBody = await loginResponse.json().catch(() => ({}));
    const token = loginBody?.token;
    if (!token) {
      throw new Error('Smoke teardown login did not return a token');
    }

    const deleteResponse = await context.request.delete(
      `${identity.baseURL}/api/user/delete`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        timeout: 60_000,
      },
    );
    const responseBody = await deleteResponse.json().catch(() => ({}));
    const teardownStatus = responseBody?.tenant_teardown_status;
    const teardownAttempted = responseBody?.tenant_teardown_attempted;

    const result = {
      ok: deleteResponse.ok(),
      status: deleteResponse.status(),
      body: responseBody,
    };
    fs.writeFileSync(resultPath, JSON.stringify(result, null, 2), 'utf8');

    if (!deleteResponse.ok()) {
      throw new Error(`Smoke teardown delete failed with status=${deleteResponse.status()}`);
    }
    if (!teardownAttempted || teardownStatus !== 'succeeded') {
      throw new Error(
        `Expected tenant teardown to succeed, got attempted=${String(teardownAttempted)} status=${String(teardownStatus)}`,
      );
    }
  } finally {
    await context.close();
    await browser.close();
  }
}

export default globalTeardown;
