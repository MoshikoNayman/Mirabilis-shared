import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import { createIntelLedgerRoutes } from './routes/intelLedger.js';

function createApp(storage) {
  const app = express();
  app.use(express.json());
  app.use('/api/intelledger', createIntelLedgerRoutes(storage, {
    streamWithProvider: async () => {},
    getEffectiveModel: async () => 'test-model',
    config: {
      intelLedgerStorePath: '/tmp/intelledger-test-store.json',
      aiProvider: 'ollama',
      openAIApiKey: '',
      openAIBaseUrl: ''
    }
  }));
  return app;
}

async function withServer(app, callback) {
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });

  try {
    const { port } = server.address();
    await callback(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

test('rejects spoofed identity when trusted auth context is present', async () => {
  const storage = {
    listSessions: async () => []
  };
  const app = createApp(storage);

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/intelledger/sessions?userId=spoof-user&tenantId=spoof-tenant`, {
      headers: {
        'x-auth-user-id': 'trusted-user',
        'x-auth-tenant-id': 'trusted-tenant',
        'x-intelledger-tenant-id': 'spoof-tenant'
      }
    });
    assert.equal(response.status, 403);
  });
});

test('uses trusted auth identity for list operations', async () => {
  let capturedArgs = null;
  const storage = {
    listSessions: async (userId, options) => {
      capturedArgs = { userId, options };
      return [];
    }
  };
  const app = createApp(storage);

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/intelledger/sessions`, {
      headers: {
        'x-auth-user-id': 'trusted-user',
        'x-auth-tenant-id': 'trusted-tenant'
      }
    });
    assert.equal(response.status, 200);
  });

  assert.deepEqual(capturedArgs, {
    userId: 'trusted-user',
    options: { tenantId: 'trusted-tenant' }
  });
});

test('denies session access when tenant claim does not match session tenant', async () => {
  const storage = {
    getSession: async () => ({ id: 's1', tenant_id: 'tenant-a', user_id: 'trusted-user' }),
    getInteractions: async () => [],
    getSignalsBySession: async () => [],
    getActionsBySession: async () => []
  };
  const app = createApp(storage);

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/intelledger/sessions/s1/brief`, {
      headers: {
        'x-auth-user-id': 'trusted-user',
        'x-auth-tenant-id': 'tenant-b'
      }
    });
    assert.equal(response.status, 404);
  });
});

test('requires trusted identity when strict auth mode is enabled', async () => {
  const previousValue = process.env.INTELLEDGER_REQUIRE_AUTH_CONTEXT;
  process.env.INTELLEDGER_REQUIRE_AUTH_CONTEXT = '1';

  const storage = {
    listSessions: async () => []
  };
  const app = createApp(storage);

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/intelledger/sessions?userId=legacy-user&tenantId=legacy-tenant`);
    assert.equal(response.status, 401);
  });

  if (previousValue === undefined) {
    delete process.env.INTELLEDGER_REQUIRE_AUTH_CONTEXT;
  } else {
    process.env.INTELLEDGER_REQUIRE_AUTH_CONTEXT = previousValue;
  }
});
