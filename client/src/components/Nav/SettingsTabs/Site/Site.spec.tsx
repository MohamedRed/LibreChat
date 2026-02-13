import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react';
import Site from './Site';

const mockShowToast = jest.fn();

let mockWidgetKey = 'wpk_initial';
let mockWidgetConfig = {
  site_id: 1,
  site_key: 'wpk_initial',
  enabled: true,
  settings: {},
  embed_script_url: 'https://liive.app/widget/v1/loader.js',
  frame_url: 'https://liive.app/widget/v1/frame',
};
const mockRefetchWidgetConfig = jest.fn(async () => ({ data: mockWidgetConfig }));

const mockRunCrawlRefetch = jest.fn();
const mockActionsRefetch = jest.fn();

const mockRotateMutate = jest.fn();
const mockUpdateWidgetMutate = jest.fn();

jest.mock(
  '@librechat/client',
  () => ({
    Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
    Input: (props: any) => <input {...props} />,
    Label: ({ children, ...props }: any) => <label {...props}>{children}</label>,
    Spinner: () => <span data-testid="spinner" />,
    useToastContext: () => ({ showToast: mockShowToast }),
  }),
  { virtual: true },
);

jest.mock(
  'librechat-data-provider',
  () => ({
    SystemRoles: {
      ADMIN: 'ADMIN',
      USER: 'USER',
    },
    setTokenHeader: jest.fn(),
  }),
  { virtual: true },
);

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, values?: Record<string, string>) => {
    if (!values) {
      return key;
    }
    let text = key;
    Object.entries(values).forEach(([k, v]) => {
      text = text.replace(`{{${k}}}`, String(v));
    });
    return text;
  },
}));

jest.mock('~/utils', () => ({
  cn: (...parts: string[]) => parts.filter(Boolean).join(' '),
  defaultTextProps: '',
  removeFocusOutlines: '',
}));

jest.mock('~/data-provider', () => ({
  useGetTenantSite: () => ({
    data: {
      id: 1,
      base_url: 'https://example.com',
      sitemap_url: null,
      verified_at: null,
    },
    isFetching: false,
    isLoading: false,
  }),
  useGetTenantActions: () => ({
    data: [],
    isFetching: false,
    refetch: mockActionsRefetch,
  }),
  useGetTenantCrawlStatus: () => ({
    data: null,
    isFetching: false,
    refetch: mockRunCrawlRefetch,
  }),
  useGetTenantWidgetConfig: () => ({
    data: mockWidgetConfig,
    isFetching: false,
    refetch: mockRefetchWidgetConfig,
  }),
  useUpsertTenantSite: () => ({
    isLoading: false,
    mutate: jest.fn(),
  }),
  useRunTenantCrawl: () => ({
    isLoading: false,
    mutate: jest.fn(),
  }),
  useCreateTenantBillingCheckout: () => ({
    isLoading: false,
    mutate: jest.fn(),
  }),
  useDiscoverTenantActions: () => ({
    isLoading: false,
    mutate: jest.fn(),
  }),
  useUpdateTenantWidgetConfig: (options?: any) => ({
    isLoading: false,
    mutate: (payload: any) => {
      mockUpdateWidgetMutate(payload);
      mockWidgetConfig = {
        ...mockWidgetConfig,
        enabled: Boolean(payload?.enabled),
      };
      options?.onSuccess?.(mockWidgetConfig, payload, undefined);
    },
  }),
  useRotateTenantWidgetKey: (options?: any) => ({
    isLoading: false,
    mutate: () => {
      mockRotateMutate();
      mockWidgetKey = 'wpk_rotated';
      mockWidgetConfig = {
        ...mockWidgetConfig,
        site_key: mockWidgetKey,
      };
      options?.onSuccess?.(mockWidgetConfig, undefined, undefined);
    },
  }),
}));

describe('Site settings widget section', () => {
  beforeEach(() => {
    mockWidgetKey = 'wpk_initial';
    mockWidgetConfig = {
      site_id: 1,
      site_key: 'wpk_initial',
      enabled: true,
      settings: {},
      embed_script_url: 'https://liive.app/widget/v1/loader.js',
      frame_url: 'https://liive.app/widget/v1/frame',
    };
    mockShowToast.mockReset();
    mockRefetchWidgetConfig.mockClear();
    mockRotateMutate.mockClear();
    mockUpdateWidgetMutate.mockClear();
    mockRunCrawlRefetch.mockClear();
    mockActionsRefetch.mockClear();
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: jest.fn().mockResolvedValue(undefined),
      },
      configurable: true,
    });
  });

  test('renders install snippet with site key', () => {
    const { getByText } = render(<Site />);
    expect(getByText(/window\.LiiveWidget = \{ siteKey: "wpk_initial" \};/)).toBeInTheDocument();
    expect(getByText(/https:\/\/liive\.app\/widget\/v1\/loader\.js/)).toBeInTheDocument();
  });

  test('rotate key refreshes snippet', async () => {
    const firstRender = render(<Site />);
    const { getByTestId } = firstRender;
    fireEvent.click(getByTestId('tenant-widget-rotate'));
    await waitFor(() => {
      expect(mockRotateMutate).toHaveBeenCalled();
      expect(mockWidgetConfig.site_key).toBe('wpk_rotated');
      expect(mockRefetchWidgetConfig).toHaveBeenCalled();
    });

    firstRender.unmount();
    const secondRender = render(<Site />);
    expect(
      secondRender.getByText(/window\.LiiveWidget = \{ siteKey: "wpk_rotated" \};/),
    ).toBeInTheDocument();
  });

  test('copy uses latest snippet after rotate', async () => {
    const firstRender = render(<Site />);
    const { getByTestId } = firstRender;
    fireEvent.click(getByTestId('tenant-widget-rotate'));
    await waitFor(() => {
      expect(mockRotateMutate).toHaveBeenCalledTimes(1);
      expect(mockWidgetConfig.site_key).toBe('wpk_rotated');
      expect(mockRefetchWidgetConfig).toHaveBeenCalled();
    });
    firstRender.unmount();
    const secondRender = render(<Site />);

    fireEvent.click(secondRender.getByTestId('tenant-widget-copy-snippet'));
    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalled();
    });

    const copied = (navigator.clipboard.writeText as jest.Mock).mock.calls[0][0];
    expect(copied).toContain('wpk_rotated');
    expect(copied).toContain('https://liive.app/widget/v1/loader.js');
  });
});
