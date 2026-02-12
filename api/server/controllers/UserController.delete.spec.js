const axios = require('axios');

jest.mock('axios', () => ({
  delete: jest.fn(),
}));

process.env.CONTROL_PLANE_URL = 'https://control-plane.example.com';
process.env.CONTROL_PLANE_INTERNAL_KEY = 'cp_internal_key';

jest.mock('@librechat/data-schemas', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
  webSearchKeys: [],
}));

jest.mock('librechat-data-provider', () => ({
  Tools: { web_search: 'web_search' },
  CacheKeys: { FLOWS: 'flows' },
  Constants: { mcp_prefix: 'mcp_', mcp_delimiter: ':' },
  FileSources: { s3: 's3' },
}));

jest.mock('@librechat/api', () => ({
  MCPOAuthHandler: {
    generateFlowId: jest.fn().mockReturnValue('flow'),
    revokeOAuthToken: jest.fn(),
  },
  MCPTokenStorage: {
    getClientInfoAndMetadata: jest.fn(),
    getTokens: jest.fn(),
    deleteUserTokens: jest.fn(),
  },
  normalizeHttpError: jest.fn((value) => value),
  extractWebSearchEnvVars: jest.fn(({ keys }) => keys),
}));

jest.mock('~/models', () => ({
  deleteAllUserSessions: jest.fn().mockResolvedValue(undefined),
  deleteAllSharedLinks: jest.fn().mockResolvedValue(undefined),
  updateUserPlugins: jest.fn().mockResolvedValue(undefined),
  deleteUserById: jest.fn().mockResolvedValue(undefined),
  deleteMessages: jest.fn().mockResolvedValue(undefined),
  deletePresets: jest.fn().mockResolvedValue(undefined),
  deleteUserKey: jest.fn().mockResolvedValue(undefined),
  deleteConvos: jest.fn().mockResolvedValue(undefined),
  deleteFiles: jest.fn().mockResolvedValue(undefined),
  updateUser: jest.fn().mockResolvedValue(undefined),
  findToken: jest.fn(),
  getFiles: jest.fn().mockResolvedValue([]),
}));
jest.mock('~/server/services/PluginService', () => ({
  updateUserPluginAuth: jest.fn(),
  deleteUserPluginAuth: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('~/server/services/AuthService', () => ({
  verifyEmail: jest.fn(),
  resendVerificationEmail: jest.fn(),
}));
jest.mock('~/config', () => ({
  getMCPManager: jest.fn(),
  getFlowStateManager: jest.fn().mockReturnValue({ deleteFlow: jest.fn() }),
  getMCPServersRegistry: jest.fn().mockReturnValue({
    getServerConfig: jest.fn(),
    getOAuthServers: jest.fn().mockResolvedValue(new Set()),
  }),
}));
jest.mock('~/server/services/Files/S3/crud', () => ({
  needsRefresh: jest.fn().mockReturnValue(false),
  getNewS3URL: jest.fn(),
}));
jest.mock('~/server/services/Files/process', () => ({
  processDeleteRequest: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('~/server/services/Config', () => ({
  getAppConfig: jest.fn().mockResolvedValue({ fileStrategy: 'local' }),
}));
jest.mock('~/models/ToolCall', () => ({
  deleteToolCalls: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('~/models/Prompt', () => ({
  deleteUserPrompts: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('~/models/Agent', () => ({
  deleteUserAgents: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('~/cache', () => ({
  getLogStores: jest.fn(),
}));

jest.mock('~/db/models', () => ({
  ConversationTag: { deleteMany: jest.fn().mockResolvedValue(undefined) },
  Transaction: { deleteMany: jest.fn().mockResolvedValue(undefined) },
  MemoryEntry: { deleteMany: jest.fn().mockResolvedValue(undefined) },
  Assistant: { deleteMany: jest.fn().mockResolvedValue(undefined) },
  AclEntry: { deleteMany: jest.fn().mockResolvedValue(undefined) },
  Balance: { deleteMany: jest.fn().mockResolvedValue(undefined) },
  Action: { deleteMany: jest.fn().mockResolvedValue(undefined) },
  Group: { updateMany: jest.fn().mockResolvedValue(undefined) },
  Token: { deleteMany: jest.fn().mockResolvedValue(undefined) },
  User: { countDocuments: jest.fn() },
}));

const { deleteUserController } = require('./UserController');
const { User } = require('~/db/models');

const createRes = () => ({
  status: jest.fn().mockReturnThis(),
  send: jest.fn().mockReturnThis(),
  json: jest.fn().mockReturnThis(),
});

describe('deleteUserController', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('does not teardown tenant when user is not last in tenant', async () => {
    User.countDocuments.mockResolvedValue(1);
    const req = {
      user: {
        id: 'u1',
        _id: 'u1',
        email: 'user@example.com',
        tenantId: 'tenant-a',
      },
    };
    const res = createRes();

    await deleteUserController(req, res);

    expect(axios.delete).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'User deleted',
        tenant_teardown_attempted: false,
        tenant_teardown_status: 'not_applicable',
        tenant_id: 'tenant-a',
      }),
    );
  });

  test('tears down tenant when deleting last tenant user', async () => {
    User.countDocuments.mockResolvedValue(0);
    axios.delete.mockResolvedValue({ data: { status: 'deleted' } });
    const req = {
      user: {
        id: 'u2',
        _id: 'u2',
        email: 'user2@example.com',
        tenantId: 'tenant-b',
      },
    };
    const res = createRes();

    await deleteUserController(req, res);

    expect(axios.delete).toHaveBeenCalledWith(
      'https://control-plane.example.com/internal/tenants/tenant-b/teardown',
      expect.objectContaining({
        headers: { Authorization: 'Bearer cp_internal_key' },
      }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_teardown_attempted: true,
        tenant_teardown_status: 'succeeded',
        tenant_id: 'tenant-b',
      }),
    );
  });

  test('returns non-2xx when tenant teardown fails for last user', async () => {
    User.countDocuments.mockResolvedValue(0);
    axios.delete.mockRejectedValue(new Error('teardown failed'));
    const req = {
      user: {
        id: 'u3',
        _id: 'u3',
        email: 'user3@example.com',
        tenantId: 'tenant-c',
      },
    };
    const res = createRes();

    await deleteUserController(req, res);

    expect(res.status).toHaveBeenCalledWith(502);
    expect(res.send).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_teardown_attempted: true,
        tenant_teardown_status: 'failed',
        tenant_id: 'tenant-c',
      }),
    );
  });
});
