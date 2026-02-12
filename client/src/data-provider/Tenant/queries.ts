import { useRecoilValue } from 'recoil';
import { useQuery } from '@tanstack/react-query';
import type { QueryObserverResult, UseQueryOptions } from '@tanstack/react-query';
import type t from 'librechat-data-provider';
import { QueryKeys, dataService } from 'librechat-data-provider';
import store from '~/store';

export const useGetTenantSite = (
  config?: UseQueryOptions<t.TTenantSite | null>,
): QueryObserverResult<t.TTenantSite | null> => {
  const queriesEnabled = useRecoilValue<boolean>(store.queriesEnabled);
  return useQuery<t.TTenantSite | null>(
    [QueryKeys.tenantSite],
    async () => {
      try {
        return await dataService.getTenantSite();
      } catch (err: any) {
        if (err?.response?.status === 404) {
          return null;
        }
        throw err;
      }
    },
    {
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      refetchOnMount: false,
      ...config,
      enabled: (config?.enabled ?? true) === true && queriesEnabled,
    },
  );
};

export const useGetTenantActions = (
  params: t.TTenantActionsQuery = {},
  config?: UseQueryOptions<t.TTenantAction[]>,
): QueryObserverResult<t.TTenantAction[]> => {
  const queriesEnabled = useRecoilValue<boolean>(store.queriesEnabled);
  return useQuery<t.TTenantAction[]>(
    [QueryKeys.tenantActions, params],
    () => dataService.getTenantActions(params),
    {
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      refetchOnMount: false,
      ...config,
      enabled: (config?.enabled ?? true) === true && queriesEnabled,
    },
  );
};

export const useGetTenantCrawlStatus = (
  params: { site_id?: number } = {},
  config?: UseQueryOptions<t.TTenantCrawlStatusResponse>,
): QueryObserverResult<t.TTenantCrawlStatusResponse> => {
  const queriesEnabled = useRecoilValue<boolean>(store.queriesEnabled);
  return useQuery<t.TTenantCrawlStatusResponse>(
    [QueryKeys.tenantCrawlStatus, params],
    () => dataService.getTenantCrawlStatus(params),
    {
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      refetchOnMount: false,
      ...config,
      enabled: (config?.enabled ?? true) === true && queriesEnabled,
    },
  );
};
