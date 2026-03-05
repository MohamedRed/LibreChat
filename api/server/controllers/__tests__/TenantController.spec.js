const axios = require('axios');

jest.mock('axios');
jest.mock(
  '@librechat/data-schemas',
  () => ({
    logger: {
      error: jest.fn(),
      warn: jest.fn(),
      info: jest.fn(),
    },
  }),
  { virtual: true },
);

process.env.CONTROL_PLANE_URL = 'https://cp.example.com';
process.env.CONTROL_PLANE_API_KEY = 'cp_api';
process.env.CONTROL_PLANE_INTERNAL_KEY = 'cp_internal';

const { getTenantReliabilitySummary, siteAssistantChat } = require('../TenantController');

const buildRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe('TenantController reliability routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterAll(() => {
    delete process.env.CONTROL_PLANE_URL;
    delete process.env.CONTROL_PLANE_API_KEY;
    delete process.env.CONTROL_PLANE_INTERNAL_KEY;
  });

  test('getTenantReliabilitySummary proxies success response', async () => {
    axios.get.mockResolvedValueOnce({ data: { total_events: 5 } });

    const req = { user: { tenantId: 'tenant-1' } };
    const res = buildRes();

    await getTenantReliabilitySummary(req, res);

    expect(axios.get).toHaveBeenCalledWith(
      'https://cp.example.com/api/reliability/summary',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer cp_api',
          'X-Tenant-ID': 'tenant-1',
        }),
      }),
    );
    expect(res.json).toHaveBeenCalledWith({ total_events: 5 });
  });

  test('siteAssistantChat validates message presence', async () => {
    const req = { user: { tenantId: 'tenant-1' }, body: {} };
    const res = buildRes();

    await siteAssistantChat(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: 'message is required' });
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('siteAssistantChat maps control-plane 4xx errors', async () => {
    axios.post.mockRejectedValueOnce({
      response: {
        status: 403,
        data: { detail: 'Tenant not allowed: pending' },
      },
    });
    const req = {
      user: { tenantId: 'tenant-1' },
      body: { message: 'hello', site_id: 2 },
    };
    const res = buildRes();

    await siteAssistantChat(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ message: 'Tenant not allowed: pending' });
  });
});
