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

module.exports = router;
