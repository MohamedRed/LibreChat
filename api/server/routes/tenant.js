const express = require('express');
const { requireJwtAuth } = require('~/server/middleware');
const {
  getTenantSite,
  upsertTenantSite,
  runTenantCrawl,
  createBillingCheckout,
  getTenantActions,
  discoverTenantActions,
  getTenantCrawlStatus,
  getTenantCrawlStatusById,
  getTenantWidgetConfig,
  updateTenantWidgetConfig,
  rotateTenantWidgetKey,
  getTenantReliabilitySummary,
  runTenantReliabilityBenchmark,
  getTenantReliabilityBenchmarkRuns,
  siteAssistantChat,
} = require('~/server/controllers/TenantController');

const router = express.Router();

router.use(requireJwtAuth);
router.get('/site', getTenantSite);
router.post('/site', upsertTenantSite);
router.post('/crawl', runTenantCrawl);
router.get('/crawl/status', getTenantCrawlStatus);
router.get('/crawl/status/:jobId', getTenantCrawlStatusById);
router.post('/billing/checkout', createBillingCheckout);
router.get('/actions', getTenantActions);
router.post('/actions/discover', discoverTenantActions);
router.get('/widget/config', getTenantWidgetConfig);
router.put('/widget/config', updateTenantWidgetConfig);
router.post('/widget/config/rotate-key', rotateTenantWidgetKey);
router.get('/reliability/summary', getTenantReliabilitySummary);
router.get('/reliability/benchmark/runs', getTenantReliabilityBenchmarkRuns);
router.post('/reliability/benchmark/run', runTenantReliabilityBenchmark);
router.post('/site-assistant/chat', siteAssistantChat);

module.exports = router;
