const cookies = require('cookie');
const passport = require('passport');
const axios = require('axios');
const { logger } = require('@librechat/data-schemas');
const { isEnabled } = require('@librechat/api');

const TENANT_CACHE_TTL_MS = parseInt(process.env.TENANT_CACHE_TTL_MS, 10) || 5 * 60 * 1000;
const tenantStatusCache = new Map();

const fetchTenantStatus = async (tenantId) => {
  if (!process.env.CONTROL_PLANE_URL || !process.env.CONTROL_PLANE_INTERNAL_KEY) {
    throw new Error('Control plane not configured');
  }

  const cached = tenantStatusCache.get(tenantId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  const response = await axios.get(
    `${process.env.CONTROL_PLANE_URL}/internal/tenants/${tenantId}`,
    {
      headers: {
        'X-API-Key': process.env.CONTROL_PLANE_INTERNAL_KEY,
      },
    },
  );

  const data = response.data ?? {};
  tenantStatusCache.set(tenantId, { data, expiresAt: Date.now() + TENANT_CACHE_TTL_MS });
  return data;
};

const ensureTenantActive = async (req, res, next) => {
  try {
    const tenantId = req.user?.tenantId;
    if (!tenantId) {
      return res.status(403).json({ message: 'Tenant not configured' });
    }

    const tenantState = await fetchTenantStatus(tenantId);
    const status = tenantState?.status;
    const accessAllowed = typeof tenantState?.access_allowed === 'boolean'
      ? tenantState.access_allowed
      : status === 'active' || status === 'trialing' || status === 'pending';

    if (!accessAllowed) {
      const message = tenantState?.billing_required ? 'Billing required' : 'Tenant inactive';
      return res.status(403).json({ message, reason: tenantState?.reason || 'tenant_inactive' });
    }

    return next();
  } catch (error) {
    logger.error('[requireJwtAuth] Tenant verification failed', error);
    return res.status(500).json({ message: 'Tenant verification failed' });
  }
};

/**
 * Custom Middleware to handle JWT authentication, with support for OpenID token reuse
 * Switches between JWT and OpenID authentication based on cookies and environment settings
 */
const requireJwtAuth = (req, res, next) => {
  // Check if token provider is specified in cookies
  const cookieHeader = req.headers.cookie;
  const tokenProvider = cookieHeader ? cookies.parse(cookieHeader).token_provider : null;

  // Use OpenID authentication if token provider is OpenID and OPENID_REUSE_TOKENS is enabled
  const strategy = tokenProvider === 'openid' && isEnabled(process.env.OPENID_REUSE_TOKENS)
    ? 'openidJwt'
    : 'jwt';

  return passport.authenticate(strategy, { session: false }, async (err, user) => {
    if (err) {
      return next(err);
    }
    if (!user) {
      return res.status(401).json({ message: 'Unauthorized' });
    }
    req.user = user;
    return ensureTenantActive(req, res, next);
  })(req, res, next);
};

module.exports = requireJwtAuth;
