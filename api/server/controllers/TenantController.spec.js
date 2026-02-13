const axios = require('axios');

jest.mock('axios', () => ({
  get: jest.fn(),
  post: jest.fn(),
  put: jest.fn(),
}));

jest.mock(
  '@librechat/data-schemas',
  () => ({
    logger: {
      error: jest.fn(),
    },
  }),
  { virtual: true },
);

process.env.CONTROL_PLANE_URL = 'https://control-plane.example.com';
process.env.CONTROL_PLANE_API_KEY = 'cp_api_key';
process.env.CONTROL_PLANE_INTERNAL_KEY = 'cp_internal_key';

const {
  getTenantWidgetConfig,
  updateTenantWidgetConfig,
  rotateTenantWidgetKey,
} = require('./TenantController');

const createRes = () => ({
  status: jest.fn().mockReturnThis(),
  json: jest.fn().mockReturnThis(),
});

describe('TenantController widget proxy', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('getTenantWidgetConfig success', async () => {
    const req = { user: { tenantId: 'tenant-123' } };
    const res = createRes();
    axios.get.mockResolvedValue({
      data: {
        site_id: 1,
        site_key: 'wpk_abc',
        enabled: true,
        embed_script_url: 'https://liive.app/widget/v1/loader.js',
        frame_url: 'https://liive.app/widget/v1/frame',
      },
    });

    await getTenantWidgetConfig(req, res);

    expect(axios.get).toHaveBeenCalledWith(
      'https://control-plane.example.com/api/widget/config',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer cp_api_key',
          'X-Tenant-ID': 'tenant-123',
        }),
      }),
    );
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ site_key: 'wpk_abc' }));
  });

  test('updateTenantWidgetConfig maps 4xx errors', async () => {
    const req = {
      user: { tenantId: 'tenant-123' },
      body: { enabled: false },
    };
    const res = createRes();
    axios.put.mockRejectedValue({
      response: {
        status: 400,
        data: { detail: 'invalid payload' },
      },
    });

    await updateTenantWidgetConfig(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: 'invalid payload' });
  });

  test('rotateTenantWidgetKey maps upstream 5xx to 502', async () => {
    const req = { user: { tenantId: 'tenant-123' } };
    const res = createRes();
    axios.post.mockRejectedValue({
      response: {
        status: 500,
        data: { message: 'upstream failure' },
      },
    });

    await rotateTenantWidgetKey(req, res);

    expect(res.status).toHaveBeenCalledWith(502);
    expect(res.json).toHaveBeenCalledWith({ message: 'Failed to rotate widget key' });
  });
});
