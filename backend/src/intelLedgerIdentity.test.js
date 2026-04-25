import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveIntelLedgerIdentity } from './intelLedgerIdentity.js';

test('uses trusted auth headers over client-provided values', () => {
  const identity = resolveIntelLedgerIdentity({
    headers: {
      'x-auth-user-id': 'trusted-user',
      'x-auth-tenant-id': 'trusted-tenant',
      'x-intelledger-tenant-id': 'spoof-tenant'
    },
    query: { userId: 'spoof-user', tenantId: 'spoof-tenant' },
    body: { userId: 'spoof-user-2', tenantId: 'spoof-tenant-2' }
  });

  assert.equal(identity.userId, 'trusted-user');
  assert.equal(identity.tenantId, 'trusted-tenant');
  assert.equal(identity.mismatch.user, true);
  assert.equal(identity.mismatch.tenant, true);
});

test('keeps legacy behavior when no trusted auth context exists', () => {
  const identity = resolveIntelLedgerIdentity({
    headers: { 'x-intelledger-tenant-id': 'legacy-tenant' },
    query: { userId: 'legacy-user' },
    body: {}
  });

  assert.equal(identity.userId, 'legacy-user');
  assert.equal(identity.tenantId, 'legacy-tenant');
  assert.equal(identity.hasTrustedContext, false);
  assert.equal(identity.authRequiredButMissing, false);
});

test('flags missing auth context in strict mode', () => {
  const identity = resolveIntelLedgerIdentity(
    {
      headers: { 'x-intelledger-tenant-id': 'legacy-tenant' },
      query: { userId: 'legacy-user' },
      body: {}
    },
    { requireAuthContext: true }
  );

  assert.equal(identity.authRequiredButMissing, true);
  assert.equal(identity.userId, null);
  assert.equal(identity.tenantId, null);
});

test('accepts trusted request when values match', () => {
  const identity = resolveIntelLedgerIdentity({
    headers: {
      'x-auth-user-id': 'trusted-user',
      'x-auth-tenant-id': 'trusted-tenant',
      'x-intelledger-tenant-id': 'trusted-tenant'
    },
    query: { userId: 'trusted-user' },
    body: {}
  });

  assert.equal(identity.userId, 'trusted-user');
  assert.equal(identity.tenantId, 'trusted-tenant');
  assert.equal(identity.mismatch.user, false);
  assert.equal(identity.mismatch.tenant, false);
});
