const axios = require('axios');
const { logger } = require('@librechat/data-schemas');

const controlPlaneUrl = process.env.CONTROL_PLANE_URL;
const controlPlaneApiKey = process.env.CONTROL_PLANE_API_KEY;
const controlPlaneInternalKey = process.env.CONTROL_PLANE_INTERNAL_KEY;

const requireTenantId = (req) => {
  const tenantId = req.user?.tenantId;
  if (!tenantId) {
    return { error: 'Missing tenant context' };
  }
  return { tenantId };
};

const controlPlaneHeaders = (token) => ({
  headers: {
    Authorization: `Bearer ${token}`,
  },
  timeout: 15000,
});

const getTenantSite = async (req, res) => {
  if (!controlPlaneUrl || !controlPlaneInternalKey) {
    return res.status(500).json({ message: 'Control plane not configured' });
  }

  const { tenantId, error } = requireTenantId(req);
  if (error) {
    return res.status(400).json({ message: error });
  }

  try {
    const response = await axios.get(
      `${controlPlaneUrl}/internal/tenants/${tenantId}/sites/primary`,
      controlPlaneHeaders(controlPlaneInternalKey),
    );
    return res.json(response.data);
  } catch (err) {
    const status = err?.response?.status;
    if (status === 404) {
      return res.status(404).json({ message: 'Site not found' });
    }
    logger.error('[getTenantSite] Failed to fetch site', err?.response?.data || err);
    return res.status(502).json({ message: 'Failed to fetch site' });
  }
};

const createBillingCheckout = async (req, res) => {
  if (!controlPlaneUrl || !controlPlaneApiKey) {
    return res.status(500).json({ message: 'Control plane not configured' });
  }

  const { tenantId, error } = requireTenantId(req);
  if (error) {
    return res.status(400).json({ message: error });
  }

  try {
    const response = await axios.post(
      `${controlPlaneUrl}/api/billing/checkout`,
      { email: req.user?.email },
      {
        headers: {
          Authorization: `Bearer ${controlPlaneApiKey}`,
          'X-Tenant-ID': tenantId,
        },
        timeout: 15000,
      },
    );
    return res.json(response.data);
  } catch (err) {
    const status = err?.response?.status;
    if (status && status >= 400 && status < 500) {
      return res.status(status).json({
        message: err?.response?.data?.detail || err?.response?.data?.message || 'Request failed',
      });
    }
    logger.error(
      '[createBillingCheckout] Failed to create checkout session',
      err?.response?.data || err,
    );
    return res.status(502).json({ message: 'Failed to start billing' });
  }
};

const getTenantActions = async (req, res) => {
  if (!controlPlaneUrl || !controlPlaneApiKey) {
    return res.status(500).json({ message: 'Control plane not configured' });
  }

  const { tenantId, error } = requireTenantId(req);
  if (error) {
    return res.status(400).json({ message: error });
  }

  const { site_id, url } = req.query ?? {};
  const params = new URLSearchParams();
  if (site_id) {
    params.set('site_id', site_id);
  }
  if (url) {
    params.set('url', url);
  }

  try {
    const response = await axios.get(
      `${controlPlaneUrl}/api/actions${params.toString() ? `?${params.toString()}` : ''}`,
      {
        headers: {
          Authorization: `Bearer ${controlPlaneApiKey}`,
          'X-Tenant-ID': tenantId,
        },
        timeout: 15000,
      },
    );
    return res.json(response.data);
  } catch (err) {
    logger.error('[getTenantActions] Failed to fetch actions', err?.response?.data || err);
    return res.status(502).json({ message: 'Failed to fetch actions' });
  }
};

const discoverTenantActions = async (req, res) => {
  if (!controlPlaneUrl || !controlPlaneApiKey) {
    return res.status(500).json({ message: 'Control plane not configured' });
  }

  const { tenantId, error } = requireTenantId(req);
  if (error) {
    return res.status(400).json({ message: error });
  }

  const { url, site_id } = req.body ?? {};
  if (!url) {
    return res.status(400).json({ message: 'url is required' });
  }

  try {
    const response = await axios.post(
      `${controlPlaneUrl}/api/actions/discover`,
      { url, site_id: site_id || undefined },
      {
        headers: {
          Authorization: `Bearer ${controlPlaneApiKey}`,
          'X-Tenant-ID': tenantId,
        },
        timeout: 15000,
      },
    );
    return res.json(response.data);
  } catch (err) {
    const status = err?.response?.status;
    if (status && status >= 400 && status < 500) {
      return res.status(status).json({
        message: err?.response?.data?.detail || err?.response?.data?.message || 'Request failed',
      });
    }
    logger.error(
      '[discoverTenantActions] Failed to enqueue action discovery',
      err?.response?.data || err,
    );
    return res.status(502).json({ message: 'Failed to discover actions' });
  }
};

const getTenantCrawlStatus = async (req, res) => {
  if (!controlPlaneUrl || !controlPlaneApiKey) {
    return res.status(500).json({ message: 'Control plane not configured' });
  }

  const { tenantId, error } = requireTenantId(req);
  if (error) {
    return res.status(400).json({ message: error });
  }

  const { site_id } = req.query ?? {};
  const params = new URLSearchParams();
  if (site_id) {
    params.set('site_id', site_id);
  }

  try {
    const response = await axios.get(
      `${controlPlaneUrl}/api/crawl/status${params.toString() ? `?${params.toString()}` : ''}`,
      {
        headers: {
          Authorization: `Bearer ${controlPlaneApiKey}`,
          'X-Tenant-ID': tenantId,
        },
        timeout: 15000,
      },
    );
    return res.json(response.data);
  } catch (err) {
    const status = err?.response?.status;
    if (status && status >= 400 && status < 500) {
      return res.status(status).json({
        message: err?.response?.data?.detail || err?.response?.data?.message || 'Request failed',
      });
    }
    logger.error('[getTenantCrawlStatus] Failed to fetch crawl status', err?.response?.data || err);
    return res.status(502).json({ message: 'Failed to fetch crawl status' });
  }
};

const getTenantCrawlStatusById = async (req, res) => {
  if (!controlPlaneUrl || !controlPlaneApiKey) {
    return res.status(500).json({ message: 'Control plane not configured' });
  }

  const { tenantId, error } = requireTenantId(req);
  if (error) {
    return res.status(400).json({ message: error });
  }

  const { jobId } = req.params ?? {};
  if (!jobId) {
    return res.status(400).json({ message: 'jobId is required' });
  }

  try {
    const response = await axios.get(`${controlPlaneUrl}/api/crawl/status/${jobId}`, {
      headers: {
        Authorization: `Bearer ${controlPlaneApiKey}`,
        'X-Tenant-ID': tenantId,
      },
      timeout: 15000,
    });
    return res.json(response.data);
  } catch (err) {
    const status = err?.response?.status;
    if (status && status >= 400 && status < 500) {
      return res.status(status).json({
        message: err?.response?.data?.detail || err?.response?.data?.message || 'Request failed',
      });
    }
    logger.error(
      '[getTenantCrawlStatusById] Failed to fetch crawl status',
      err?.response?.data || err,
    );
    return res.status(502).json({ message: 'Failed to fetch crawl status' });
  }
};

const upsertTenantSite = async (req, res) => {
  if (!controlPlaneUrl || !controlPlaneApiKey || !controlPlaneInternalKey) {
    return res.status(500).json({ message: 'Control plane not configured' });
  }

  const { tenantId, error } = requireTenantId(req);
  if (error) {
    return res.status(400).json({ message: error });
  }

  const { base_url, sitemap_url, crawl_rules } = req.body ?? {};
  if (!base_url) {
    return res.status(400).json({ message: 'base_url is required' });
  }

  let existing;
  try {
    const existingResp = await axios.get(
      `${controlPlaneUrl}/internal/tenants/${tenantId}/sites/primary`,
      controlPlaneHeaders(controlPlaneInternalKey),
    );
    existing = existingResp.data;
  } catch (err) {
    if (err?.response?.status !== 404) {
      logger.error('[upsertTenantSite] Failed to check existing site', err?.response?.data || err);
      return res.status(502).json({ message: 'Failed to check existing site' });
    }
  }

  try {
    const payload = {
      base_url,
      sitemap_url: sitemap_url || null,
      crawl_rules: crawl_rules || null,
    };
    const headers = {
      Authorization: `Bearer ${controlPlaneApiKey}`,
      'X-Tenant-ID': tenantId,
    };
    let response;
    if (existing?.id) {
      response = await axios.put(`${controlPlaneUrl}/api/sites/${existing.id}`, payload, {
        headers,
        timeout: 15000,
      });
    } else {
      response = await axios.post(`${controlPlaneUrl}/api/sites`, payload, {
        headers,
        timeout: 15000,
      });
    }
    return res.json(response.data);
  } catch (err) {
    logger.error('[upsertTenantSite] Failed to save site', err?.response?.data || err);
    return res.status(502).json({ message: 'Failed to save site' });
  }
};

const runTenantCrawl = async (req, res) => {
  if (!controlPlaneUrl || !controlPlaneApiKey) {
    return res.status(500).json({ message: 'Control plane not configured' });
  }

  const { tenantId, error } = requireTenantId(req);
  if (error) {
    return res.status(400).json({ message: error });
  }

  const { site_id } = req.body ?? {};
  try {
    const response = await axios.post(
      `${controlPlaneUrl}/api/crawl/run`,
      { tenant_id: tenantId, site_id: site_id || undefined },
      {
        headers: {
          Authorization: `Bearer ${controlPlaneApiKey}`,
        },
        timeout: 15000,
      },
    );
    return res.json(response.data);
  } catch (err) {
    const status = err?.response?.status;
    if (status && status >= 400 && status < 500) {
      return res.status(status).json({
        message: err?.response?.data?.detail || err?.response?.data?.message || 'Request failed',
      });
    }
    logger.error('[runTenantCrawl] Failed to start crawl', err?.response?.data || err);
    return res.status(502).json({ message: 'Failed to start crawl' });
  }
};

const getTenantWidgetConfig = async (req, res) => {
  if (!controlPlaneUrl || !controlPlaneApiKey) {
    return res.status(500).json({ message: 'Control plane not configured' });
  }

  const { tenantId, error } = requireTenantId(req);
  if (error) {
    return res.status(400).json({ message: error });
  }

  try {
    const response = await axios.get(`${controlPlaneUrl}/api/widget/config`, {
      headers: {
        Authorization: `Bearer ${controlPlaneApiKey}`,
        'X-Tenant-ID': tenantId,
      },
      timeout: 15000,
    });
    return res.json(response.data);
  } catch (err) {
    const status = err?.response?.status;
    if (status && status >= 400 && status < 500) {
      return res.status(status).json({
        message: err?.response?.data?.detail || err?.response?.data?.message || 'Request failed',
      });
    }
    logger.error(
      '[getTenantWidgetConfig] Failed to fetch widget config',
      err?.response?.data || err,
    );
    return res.status(502).json({ message: 'Failed to fetch widget config' });
  }
};

const updateTenantWidgetConfig = async (req, res) => {
  if (!controlPlaneUrl || !controlPlaneApiKey) {
    return res.status(500).json({ message: 'Control plane not configured' });
  }

  const { tenantId, error } = requireTenantId(req);
  if (error) {
    return res.status(400).json({ message: error });
  }

  const payload = req.body ?? {};
  try {
    const response = await axios.put(`${controlPlaneUrl}/api/widget/config`, payload, {
      headers: {
        Authorization: `Bearer ${controlPlaneApiKey}`,
        'X-Tenant-ID': tenantId,
      },
      timeout: 15000,
    });
    return res.json(response.data);
  } catch (err) {
    const status = err?.response?.status;
    if (status && status >= 400 && status < 500) {
      return res.status(status).json({
        message: err?.response?.data?.detail || err?.response?.data?.message || 'Request failed',
      });
    }
    logger.error(
      '[updateTenantWidgetConfig] Failed to update widget config',
      err?.response?.data || err,
    );
    return res.status(502).json({ message: 'Failed to update widget config' });
  }
};

const rotateTenantWidgetKey = async (req, res) => {
  if (!controlPlaneUrl || !controlPlaneApiKey) {
    return res.status(500).json({ message: 'Control plane not configured' });
  }

  const { tenantId, error } = requireTenantId(req);
  if (error) {
    return res.status(400).json({ message: error });
  }

  try {
    const response = await axios.post(
      `${controlPlaneUrl}/api/widget/config/rotate-key`,
      {},
      {
        headers: {
          Authorization: `Bearer ${controlPlaneApiKey}`,
          'X-Tenant-ID': tenantId,
        },
        timeout: 15000,
      },
    );
    return res.json(response.data);
  } catch (err) {
    const status = err?.response?.status;
    if (status && status >= 400 && status < 500) {
      return res.status(status).json({
        message: err?.response?.data?.detail || err?.response?.data?.message || 'Request failed',
      });
    }
    logger.error('[rotateTenantWidgetKey] Failed to rotate widget key', err?.response?.data || err);
    return res.status(502).json({ message: 'Failed to rotate widget key' });
  }
};

module.exports = {
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
};
