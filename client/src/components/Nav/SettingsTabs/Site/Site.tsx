import React, { useEffect, useMemo, useState } from 'react';
import { Button, Input, Label, Spinner, useToastContext } from '@librechat/client';
import { NotificationSeverity } from '~/common';
import {
  useCreateTenantBillingCheckout,
  useDiscoverTenantActions,
  useGetTenantActions,
  useGetTenantCrawlStatus,
  useGetTenantSite,
  useGetTenantWidgetConfig,
  useRotateTenantWidgetKey,
  useRunTenantCrawl,
  useUpdateTenantWidgetConfig,
  useUpsertTenantSite,
} from '~/data-provider';
import { useLocalize } from '~/hooks';
import { cn, defaultTextProps, removeFocusOutlines } from '~/utils';

function Site() {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const [baseUrl, setBaseUrl] = useState('');
  const [sitemapUrl, setSitemapUrl] = useState('');
  const [siteId, setSiteId] = useState<number | undefined>(undefined);
  const [pollCrawlStatus, setPollCrawlStatus] = useState(false);
  const [widgetEnabled, setWidgetEnabled] = useState(true);

  const siteQuery = useGetTenantSite({ retry: false });
  const siteData = siteQuery.data;
  const actionsParams = useMemo(
    () => (typeof siteId === 'number' ? { site_id: siteId } : {}),
    [siteId],
  );
  const crawlParams = useMemo(
    () => (typeof siteId === 'number' ? { site_id: siteId } : {}),
    [siteId],
  );
  const actionsQuery = useGetTenantActions(actionsParams, { enabled: typeof siteId === 'number' });
  const crawlStatusQuery = useGetTenantCrawlStatus(crawlParams, {
    enabled: typeof siteId === 'number',
    refetchInterval: (data) => {
      const status = data?.status;
      if (status === 'running' || status === 'queued' || status === 'ingesting') {
        return 10000;
      }
      return pollCrawlStatus ? 10000 : false;
    },
  });
  const widgetConfigQuery = useGetTenantWidgetConfig({ enabled: typeof siteId === 'number' });
  const widgetConfig = widgetConfigQuery.data;

  useEffect(() => {
    if (siteData) {
      setBaseUrl(siteData.base_url ?? '');
      setSitemapUrl(siteData.sitemap_url ?? '');
      setSiteId(siteData.id);
    } else {
      setSiteId(undefined);
    }
  }, [siteData]);

  useEffect(() => {
    if (!pollCrawlStatus) {
      return;
    }
    const status = crawlStatusQuery.data?.status;
    if (status && !['running', 'queued', 'ingesting'].includes(status)) {
      setPollCrawlStatus(false);
    }
  }, [pollCrawlStatus, crawlStatusQuery.data?.status]);

  useEffect(() => {
    if (widgetConfig) {
      setWidgetEnabled(Boolean(widgetConfig.enabled));
    }
  }, [widgetConfig]);

  const saveSite = useUpsertTenantSite({
    onSuccess: async () => {
      showToast({ message: localize('com_site_saved') });
      await widgetConfigQuery.refetch();
    },
    onError: () => {
      showToast({ message: localize('com_site_save_error'), status: NotificationSeverity.ERROR });
    },
  });

  const runCrawl = useRunTenantCrawl({
    onSuccess: () => {
      showToast({ message: localize('com_site_crawl_started') });
      setPollCrawlStatus(true);
      crawlStatusQuery.refetch();
    },
    onError: (error: any) => {
      const reason = error?.response?.data?.message ?? '';
      if (error?.response?.status === 402 || reason.toLowerCase().includes('billing')) {
        showToast({
          message: localize('com_site_billing_required'),
          status: NotificationSeverity.WARNING,
        });
      } else {
        showToast({
          message: localize('com_site_crawl_error'),
          status: NotificationSeverity.ERROR,
        });
      }
    },
  });

  const startBilling = useCreateTenantBillingCheckout({
    onSuccess: (data) => {
      if (data?.checkout_url) {
        window.location.assign(data.checkout_url);
        return;
      }
      showToast({
        message: localize('com_site_billing_error'),
        status: NotificationSeverity.ERROR,
      });
    },
    onError: () => {
      showToast({
        message: localize('com_site_billing_error'),
        status: NotificationSeverity.ERROR,
      });
    },
  });

  const discoverActions = useDiscoverTenantActions({
    onSuccess: () => {
      showToast({ message: localize('com_site_actions_discovery_started') });
      actionsQuery.refetch();
    },
    onError: () => {
      showToast({
        message: localize('com_site_actions_discovery_error'),
        status: NotificationSeverity.ERROR,
      });
    },
  });

  const updateWidgetConfig = useUpdateTenantWidgetConfig({
    onSuccess: (data) => {
      setWidgetEnabled(Boolean(data.enabled));
      showToast({ message: localize('com_site_widget_updated') });
    },
    onError: () => {
      showToast({
        message: localize('com_site_widget_update_error'),
        status: NotificationSeverity.ERROR,
      });
    },
  });

  const rotateWidgetKey = useRotateTenantWidgetKey({
    onSuccess: async () => {
      showToast({ message: localize('com_site_widget_key_rotated') });
      await widgetConfigQuery.refetch();
    },
    onError: () => {
      showToast({
        message: localize('com_site_widget_key_rotate_error'),
        status: NotificationSeverity.ERROR,
      });
    },
  });

  const isLoading =
    siteQuery.isFetching ||
    saveSite.isLoading ||
    runCrawl.isLoading ||
    startBilling.isLoading ||
    discoverActions.isLoading ||
    updateWidgetConfig.isLoading ||
    rotateWidgetKey.isLoading;
  const crawlStats = (crawlStatusQuery.data?.stats || {}) as Record<string, any>;
  const visited = Number(crawlStats.visited ?? 0);
  const queue = Number(crawlStats.queue ?? 0);
  const processed = Number(crawlStats.processed ?? 0);
  const ingested = Number(crawlStats.ingested ?? 0);
  const skipped = Number(crawlStats.skipped ?? 0);
  const phase = String(crawlStats.phase ?? crawlStatusQuery.data?.status ?? '');
  const crawlTotal = processed + queue;
  const crawlProgress = crawlTotal > 0 ? Math.round((processed / crawlTotal) * 100) : null;
  const ingestProgress = processed > 0 ? Math.round((ingested / processed) * 100) : null;
  const progress = phase === 'ingesting' ? ingestProgress : crawlProgress;
  const isValidUrl = useMemo(() => /^https?:\/\//i.test(baseUrl.trim()), [baseUrl]);

  const widgetInstallSnippet = useMemo(() => {
    if (!widgetConfig?.site_key || !widgetConfig?.embed_script_url) {
      return '';
    }
    return [
      '<script>',
      `  window.LiiveWidget = { siteKey: "${widgetConfig.site_key}" };`,
      '</script>',
      `<script async src="${widgetConfig.embed_script_url}"></script>`,
    ].join('\n');
  }, [widgetConfig]);

  const widgetPreviewUrl = useMemo(() => {
    if (!widgetConfig?.frame_url || !widgetConfig?.site_key) {
      return '';
    }
    let host = '';
    try {
      host = new URL(baseUrl.trim()).hostname;
    } catch (_error) {
      host = '';
    }
    if (!host) {
      return '';
    }
    const params = new URLSearchParams({
      site_key: widgetConfig.site_key,
      origin_host: host,
      page_url: baseUrl.trim(),
    });
    return `${widgetConfig.frame_url}?${params.toString()}`;
  }, [widgetConfig, baseUrl]);

  const handleSave = () => {
    if (!isValidUrl) {
      showToast({
        message: localize('com_site_base_url_invalid'),
        status: NotificationSeverity.ERROR,
      });
      return;
    }
    saveSite.mutate({
      base_url: baseUrl.trim(),
      sitemap_url: sitemapUrl.trim() || null,
    });
  };

  const handleRunCrawl = () => {
    runCrawl.mutate(siteId ? { site_id: siteId } : {});
  };

  const handleDiscoverActions = () => {
    const targetUrl = (siteData?.base_url || baseUrl || '').trim();
    if (!/^https?:\/\//i.test(targetUrl)) {
      showToast({
        message: localize('com_site_base_url_invalid'),
        status: NotificationSeverity.ERROR,
      });
      return;
    }
    discoverActions.mutate({ url: targetUrl, site_id: siteId });
  };

  const handleToggleWidget = () => {
    updateWidgetConfig.mutate({ enabled: !widgetEnabled });
  };

  const handleRotateWidgetKey = () => {
    rotateWidgetKey.mutate();
  };

  const handleCopySnippet = async () => {
    if (!widgetInstallSnippet) {
      return;
    }
    try {
      await navigator.clipboard.writeText(widgetInstallSnippet);
      showToast({ message: localize('com_site_widget_snippet_copied') });
    } catch (_error) {
      showToast({
        message: localize('com_site_widget_snippet_copy_error'),
        status: NotificationSeverity.ERROR,
      });
    }
  };

  const verifiedLabel =
    siteData?.verified_at && typeof siteData.verified_at === 'string'
      ? localize('com_site_last_verified', { 0: new Date(siteData.verified_at).toLocaleString() })
      : null;

  return (
    <div className="flex flex-col gap-4 p-2 text-sm text-text-primary">
      <div className="flex flex-col gap-2">
        <Label htmlFor="tenant-site-base">{localize('com_site_base_url_label')}</Label>
        <Input
          id="tenant-site-base"
          data-testid="tenant-site-base"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder="https://example.com"
          className={cn(
            defaultTextProps,
            'flex h-10 max-h-10 w-full resize-none border-border-medium px-3 py-2',
            removeFocusOutlines,
          )}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="tenant-site-sitemap">{localize('com_site_sitemap_url_label')}</Label>
        <Input
          id="tenant-site-sitemap"
          data-testid="tenant-site-sitemap"
          value={sitemapUrl}
          onChange={(e) => setSitemapUrl(e.target.value)}
          placeholder="https://example.com/sitemap.xml"
          className={cn(
            defaultTextProps,
            'flex h-10 max-h-10 w-full resize-none border-border-medium px-3 py-2',
            removeFocusOutlines,
          )}
        />
      </div>

      {verifiedLabel && <div className="text-xs text-text-secondary">{verifiedLabel}</div>}
      {!siteData && !siteQuery.isLoading && (
        <div className="text-xs text-text-secondary">{localize('com_site_no_site')}</div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={handleSave}
          disabled={isLoading}
          aria-label={localize('com_site_save')}
          data-testid="tenant-site-save"
        >
          {saveSite.isLoading ? <Spinner className="h-4 w-4" /> : localize('com_site_save')}
        </Button>
        <Button
          variant="outline"
          onClick={handleRunCrawl}
          disabled={isLoading}
          aria-label={localize('com_site_crawl')}
          data-testid="tenant-site-run-crawl"
        >
          {runCrawl.isLoading ? <Spinner className="h-4 w-4" /> : localize('com_site_crawl')}
        </Button>
        <Button
          variant="outline"
          onClick={() => startBilling.mutate()}
          disabled={isLoading}
          aria-label={localize('com_site_start_billing')}
          data-testid="tenant-site-start-billing"
        >
          {startBilling.isLoading ? (
            <Spinner className="h-4 w-4" />
          ) : (
            localize('com_site_start_billing')
          )}
        </Button>
        <Button
          variant="outline"
          onClick={handleDiscoverActions}
          disabled={isLoading || !siteId}
          aria-label={localize('com_site_actions_discover')}
          data-testid="tenant-site-discover-actions"
        >
          {discoverActions.isLoading ? (
            <Spinner className="h-4 w-4" />
          ) : (
            localize('com_site_actions_discover')
          )}
        </Button>
      </div>

      <div className="mt-2 flex flex-col gap-2 text-xs text-text-secondary">
        <div className="text-sm font-medium text-text-primary">
          {localize('com_site_crawl_status_title')}
        </div>
        {crawlStatusQuery.isFetching && <Spinner className="h-4 w-4" />}
        {!crawlStatusQuery.isFetching && !crawlStatusQuery.data && (
          <div>{localize('com_site_crawl_status_empty')}</div>
        )}
        {crawlStatusQuery.data && (
          <div className="rounded border border-border-medium p-2">
            <div className="text-text-primary" data-testid="tenant-crawl-status">
              {localize('com_site_crawl_status_label', {
                0: crawlStatusQuery.data.status,
                1: String(crawlStatusQuery.data.job_id),
              })}
            </div>
            {phase && (
              <div className="text-text-secondary">
                {localize('com_site_crawl_phase', { 0: phase })}
              </div>
            )}
            {typeof progress === 'number' && (
              <>
                <div className="text-text-secondary">
                  {localize('com_site_crawl_progress', { 0: `${progress}%` })}
                </div>
                <div
                  className="bg-border-medium/60 mt-1 h-2 w-full rounded"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={progress}
                >
                  <div className="h-2 rounded bg-primary" style={{ width: `${progress}%` }} />
                </div>
              </>
            )}
            <div className="text-text-secondary">
              {localize('com_site_crawl_counts', {
                0: String(visited),
                1: String(processed),
                2: String(ingested),
                3: String(skipped),
                4: String(queue),
              })}
            </div>
            {crawlStats?.updated_at && (
              <div className="text-text-secondary">
                {localize('com_site_crawl_updated', {
                  0: new Date(crawlStats.updated_at).toLocaleString(),
                })}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="mt-2 flex flex-col gap-2 text-xs text-text-secondary">
        <div className="text-sm font-medium text-text-primary">
          {localize('com_site_actions_title')}
        </div>
        {actionsQuery.isFetching && <Spinner className="h-4 w-4" />}
        {!actionsQuery.isFetching && (actionsQuery.data?.length ?? 0) === 0 && (
          <div>{localize('com_site_actions_empty')}</div>
        )}
        {(actionsQuery.data ?? []).map((action) => (
          <div key={action.id} className="rounded border border-border-medium p-2">
            <div className="text-text-primary">{action.label || action.action_type}</div>
            <div className="text-text-secondary">{action.url}</div>
            <div className="text-text-secondary">
              {action.source} · {action.method || 'N/A'}
            </div>
            {action.endpoint && <div className="text-text-secondary">{action.endpoint}</div>}
          </div>
        ))}
      </div>

      <div className="mt-2 flex flex-col gap-2 text-xs text-text-secondary">
        <div className="text-sm font-medium text-text-primary">
          {localize('com_site_widget_title')}
        </div>
        {widgetConfigQuery.isFetching && <Spinner className="h-4 w-4" />}
        {!widgetConfigQuery.isFetching && !widgetConfig && (
          <div>{localize('com_site_widget_empty')}</div>
        )}
        {widgetConfig && (
          <>
            <div className="rounded border border-border-medium p-2">
              <div className="text-text-secondary">{localize('com_site_widget_site_key')}</div>
              <div className="mt-1 break-all font-mono text-xs text-text-primary">
                {widgetConfig.site_key}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={handleToggleWidget}
                disabled={isLoading}
                data-testid="tenant-widget-toggle"
              >
                {widgetEnabled
                  ? localize('com_site_widget_disable')
                  : localize('com_site_widget_enable')}
              </Button>
              <Button
                variant="outline"
                onClick={handleRotateWidgetKey}
                disabled={isLoading}
                data-testid="tenant-widget-rotate"
              >
                {rotateWidgetKey.isLoading ? (
                  <Spinner className="h-4 w-4" />
                ) : (
                  localize('com_site_widget_rotate_key')
                )}
              </Button>
              <Button
                variant="outline"
                onClick={handleCopySnippet}
                disabled={isLoading || !widgetInstallSnippet}
                data-testid="tenant-widget-copy-snippet"
              >
                {localize('com_site_widget_copy_snippet')}
              </Button>
            </div>
            <div className="rounded border border-border-medium p-2">
              <div className="text-text-secondary">
                {localize('com_site_widget_install_snippet')}
              </div>
              <pre className="mt-1 whitespace-pre-wrap break-all font-mono text-xs text-text-primary">
                {widgetInstallSnippet}
              </pre>
            </div>
            {widgetPreviewUrl && (
              <div className="rounded border border-border-medium p-2">
                <div className="text-text-secondary">{localize('com_site_widget_preview_url')}</div>
                <div className="mt-1 break-all font-mono text-xs text-text-primary">
                  {widgetPreviewUrl}
                </div>
              </div>
            )}
            <div>{localize('com_site_widget_origin_policy_note')}</div>
          </>
        )}
      </div>
    </div>
  );
}

export default React.memo(Site);
