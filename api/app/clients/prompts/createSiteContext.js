const axios = require('axios');
const { logger } = require('@librechat/data-schemas');
const { isEnabled, generateShortLivedToken } = require('@librechat/api');

const DEFAULT_TOP_K = 4;
const DEFAULT_MAX_CHARS = 1500;
const SITE_CACHE_TTL_MS = 5 * 60 * 1000;
const siteCache = new Map();
const REQUIRE_SOURCE_URL = process.env.SITE_RAG_REQUIRE_SOURCE_URL !== 'false';
const ALLOW_ROOT_URL = process.env.SITE_RAG_ALLOW_ROOT_URL !== 'false';

async function getPrimarySite(tenantId) {
  if (!process.env.CONTROL_PLANE_URL || !process.env.CONTROL_PLANE_INTERNAL_KEY) {
    return null;
  }

  const cached = siteCache.get(tenantId);
  if (cached && Date.now() - cached.ts < SITE_CACHE_TTL_MS) {
    return cached.site;
  }

  const response = await axios.get(
    `${process.env.CONTROL_PLANE_URL.replace(/\/$/, '')}/internal/tenants/${tenantId}/sites/primary`,
    {
      headers: { Authorization: `Bearer ${process.env.CONTROL_PLANE_INTERNAL_KEY}` },
      timeout: 8000,
    },
  );
  const site = response?.data || null;
  if (site) {
    siteCache.set(tenantId, { site, ts: Date.now() });
  }
  return site;
}

function truncate(text, maxChars) {
  if (!text || text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, maxChars)}…`;
}

function isHttpUrl(value) {
  if (!value || typeof value !== 'string') {
    return false;
  }
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch (err) {
    return false;
  }
}

function isPageUrl(value) {
  if (!isHttpUrl(value)) {
    return false;
  }
  if (ALLOW_ROOT_URL) {
    return true;
  }
  const url = new URL(value);
  return url.pathname && url.pathname !== '/' ? true : Boolean(url.search || url.hash);
}

async function createSiteContext(req, userMessageContent) {
  if (!process.env.RAG_API_URL) {
    return '';
  }
  if (!isEnabled(process.env.SITE_RAG_ENABLED)) {
    return '';
  }

  const tenantId = req?.user?.tenantId;
  if (!tenantId) {
    return '';
  }

  const queryText = (userMessageContent || '').trim();
  if (!queryText) {
    return '';
  }

  const topK = Number(process.env.SITE_RAG_TOP_K || DEFAULT_TOP_K);
  const maxChars = Number(process.env.SITE_RAG_MAX_CHARS || DEFAULT_MAX_CHARS);
  const jwtToken = generateShortLivedToken(req.user.id);
  let entityId;
  try {
    const site = await getPrimarySite(tenantId);
    if (site?.id != null) {
      entityId = String(site.id);
    }
  } catch (err) {
    logger.warn('[createSiteContext] Failed to fetch primary site', err?.response?.data || err);
  }
  if (!entityId) {
    return '';
  }

  try {
    const response = await axios.post(
      `${process.env.RAG_API_URL}/query`,
      { query: queryText, k: topK, entity_id: entityId },
      {
        headers: {
          Authorization: `Bearer ${jwtToken}`,
          'Content-Type': 'application/json',
          'X-Tenant-ID': tenantId,
        },
        timeout: 15000,
      },
    );

    const results = response.data || [];
    if (!Array.isArray(results) || results.length === 0) {
      return '';
    }

    const docs = results
      .map((result) => {
        const payload = result?.[0] || {};
        const content = truncate(payload.page_content || '', maxChars);
        const meta = payload.metadata || {};
        const sourceUrl = meta.source_url || '';
        const title = meta.title || '';

        if (!content) {
          return '';
        }

        if (REQUIRE_SOURCE_URL && !isPageUrl(sourceUrl)) {
          return '';
        }

        const source = isPageUrl(sourceUrl) ? sourceUrl : '';

        return `
        <document>
          <title>${title || 'Untitled'}</title>
          <source>${source}</source>
          <content>${content}</content>
        </document>`;
      })
      .filter(Boolean)
      .join('\n');

    if (!docs) {
      return 'No page-level sources were found for this query in the client\'s indexed website. If you cannot cite a page URL, say you cannot find a source URL.';
    }

    return [
      'Use only the page-level URLs provided in <source> for citations.',
      'If you cannot cite a page URL from the indexed content, say you cannot find a source URL.',
      'The following context was retrieved from the client\'s indexed website:',
      '<documents>',
      docs,
      '</documents>',
    ].join('\n');
  } catch (error) {
    logger.error('[createSiteContext] Failed to query RAG API', error?.response?.data || error);
    return '';
  }
}

module.exports = createSiteContext;
