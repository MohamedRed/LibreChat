import fs from 'fs';
import path from 'path';

export type SmokeIdentity = {
  runTag: string;
  email: string;
  password: string;
  authToken?: string;
  companyName: string;
  subdomain: string;
  baseURL: string;
  createdAt: string;
};

export const smokeArtifactsDir = path.resolve(process.cwd(), 'e2e/.artifacts');
export const smokeIdentityPath = path.join(smokeArtifactsDir, 'smoke-identity.json');
export const smokeStorageStatePath = path.resolve(process.cwd(), 'e2e/storageState.smoke.json');

export function ensureSmokeArtifactsDir(): void {
  fs.mkdirSync(smokeArtifactsDir, { recursive: true });
}

function envRequired(name: string): string {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value.trim();
}

function sanitizeDomain(input: string): string {
  const cleaned = input.trim().toLowerCase().replace(/^@+/, '');
  if (!/^[a-z0-9.-]+$/.test(cleaned)) {
    throw new Error(`Invalid E2E_EMAIL_DOMAIN: ${input}`);
  }
  return cleaned;
}

function normalizeTagPart(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function buildRunTag(): string {
  const runId = normalizeTagPart(process.env.GITHUB_RUN_ID || '');
  const runAttempt = normalizeTagPart(process.env.GITHUB_RUN_ATTEMPT || '');
  const ts = normalizeTagPart(Date.now().toString(36));
  const base = [runId, runAttempt, ts].filter(Boolean).join('-') || ts;
  return base.slice(0, 40);
}

function buildSubdomain(runTag: string): string {
  const slug = `e2e-${runTag}`.replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '');
  const trimmed = slug.slice(0, 63);
  return trimmed.replace(/-+$/g, '') || `e2e-${Date.now().toString(36)}`;
}

export function buildSmokeIdentity(baseURL: string): SmokeIdentity {
  const emailDomain = sanitizeDomain(envRequired('E2E_EMAIL_DOMAIN'));
  const password = envRequired('E2E_PASSWORD');
  const runTag = buildRunTag();
  return {
    runTag,
    email: `e2e+${runTag}@${emailDomain}`,
    password,
    companyName: `E2E ${runTag}`,
    subdomain: buildSubdomain(runTag),
    baseURL,
    createdAt: new Date().toISOString(),
  };
}

export function writeSmokeIdentity(identity: SmokeIdentity): void {
  ensureSmokeArtifactsDir();
  fs.writeFileSync(smokeIdentityPath, JSON.stringify(identity, null, 2), 'utf8');
}

export function readSmokeIdentity(): SmokeIdentity | null {
  if (!fs.existsSync(smokeIdentityPath)) {
    return null;
  }
  const raw = fs.readFileSync(smokeIdentityPath, 'utf8');
  return JSON.parse(raw) as SmokeIdentity;
}
