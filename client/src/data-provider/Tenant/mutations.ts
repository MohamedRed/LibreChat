import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { UseMutationResult } from '@tanstack/react-query';
import type t from 'librechat-data-provider';
import { QueryKeys, dataService } from 'librechat-data-provider';

export const useUpsertTenantSite = (
  options?: t.MutationOptions<t.TTenantSite, Error, t.TTenantSiteRequest>,
): UseMutationResult<t.TTenantSite, Error, t.TTenantSiteRequest> => {
  const queryClient = useQueryClient();
  return useMutation((payload: t.TTenantSiteRequest) => dataService.upsertTenantSite(payload), {
    onSuccess: (data, variables, context) => {
      queryClient.setQueryData([QueryKeys.tenantSite], data);
      return options?.onSuccess?.(data, variables, context);
    },
    onError: (error, variables, context) => options?.onError?.(error, variables, context),
    onMutate: (variables) => options?.onMutate?.(variables),
  });
};

export const useRunTenantCrawl = (
  options?: t.MutationOptions<t.TTenantCrawlResponse, Error, t.TTenantCrawlRequest>,
): UseMutationResult<t.TTenantCrawlResponse, Error, t.TTenantCrawlRequest> => {
  return useMutation((payload: t.TTenantCrawlRequest) => dataService.runTenantCrawl(payload), {
    onSuccess: (data, variables, context) => options?.onSuccess?.(data, variables, context),
    onError: (error, variables, context) => options?.onError?.(error, variables, context),
    onMutate: (variables) => options?.onMutate?.(variables),
  });
};

export const useCreateTenantBillingCheckout = (
  options?: t.MutationOptions<t.TTenantBillingCheckoutResponse, Error, void>,
): UseMutationResult<t.TTenantBillingCheckoutResponse, Error, void> => {
  return useMutation(() => dataService.createTenantBillingCheckout(), {
    onSuccess: (data, variables, context) => options?.onSuccess?.(data, variables, context),
    onError: (error, variables, context) => options?.onError?.(error, variables, context),
    onMutate: (variables) => options?.onMutate?.(variables),
  });
};

export const useDiscoverTenantActions = (
  options?: t.MutationOptions<t.TTenantActionJobResponse, Error, t.TTenantActionsDiscoverRequest>,
): UseMutationResult<t.TTenantActionJobResponse, Error, t.TTenantActionsDiscoverRequest> => {
  return useMutation((payload: t.TTenantActionsDiscoverRequest) => dataService.discoverTenantActions(payload), {
    onSuccess: (data, variables, context) => options?.onSuccess?.(data, variables, context),
    onError: (error, variables, context) => options?.onError?.(error, variables, context),
    onMutate: (variables) => options?.onMutate?.(variables),
  });
};
