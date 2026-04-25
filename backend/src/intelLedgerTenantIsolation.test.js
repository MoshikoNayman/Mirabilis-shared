import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import os from 'node:os';
import { createIntelLedgerStorage } from './storage/intelLedger.js';

test('tenant-scoped session listing and lookup are isolated', async () => {
  const tempDir = await mkdtemp(join(os.tmpdir(), 'mirabilis-tenant-isolation-'));
  const storePath = join(tempDir, 'intelledger.json');
  const storage = createIntelLedgerStorage(storePath);

  try {
    await storage.ensureStore();

    const sessionA = await storage.createSession('u1', 'Tenant A Session', 'desc', { tenantId: 'tenant-a' });
    const sessionB = await storage.createSession('u1', 'Tenant B Session', 'desc', { tenantId: 'tenant-b' });

    const tenantASessions = await storage.listSessions('u1', { tenantId: 'tenant-a' });
    const tenantBSessions = await storage.listSessions('u1', { tenantId: 'tenant-b' });

    assert.equal(tenantASessions.length, 1);
    assert.equal(tenantBSessions.length, 1);
    assert.equal(tenantASessions[0].id, sessionA.id);
    assert.equal(tenantBSessions[0].id, sessionB.id);

    const allowed = await storage.getSessionForTenant(sessionA.id, 'tenant-a');
    const denied = await storage.getSessionForTenant(sessionA.id, 'tenant-b');

    assert.ok(allowed);
    assert.equal(allowed.id, sessionA.id);
    assert.equal(denied, null);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
