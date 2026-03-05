import {
  tenantReliabilityBenchmarkRun,
  tenantReliabilityBenchmarkRuns,
  tenantReliabilitySummary,
  tenantSiteAssistantChat,
} from '../src/api-endpoints';

describe('tenant reliability endpoints', () => {
  it('builds reliability summary endpoint', () => {
    expect(tenantReliabilitySummary()).toBe('/api/tenant/reliability/summary');
  });

  it('builds reliability benchmark run endpoint', () => {
    expect(tenantReliabilityBenchmarkRun()).toBe('/api/tenant/reliability/benchmark/run');
  });

  it('builds reliability benchmark runs endpoint with query params', () => {
    expect(tenantReliabilityBenchmarkRuns()).toBe('/api/tenant/reliability/benchmark/runs');
    expect(tenantReliabilityBenchmarkRuns({ limit: 5 })).toBe(
      '/api/tenant/reliability/benchmark/runs?limit=5',
    );
  });

  it('builds site assistant chat endpoint', () => {
    expect(tenantSiteAssistantChat()).toBe('/api/tenant/site-assistant/chat');
  });
});
