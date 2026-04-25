import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import os from 'node:os';
import { createIntelLedgerStorage } from './storage/intelLedger.js';

test('retention sweep purges stale session records', async () => {
  const tempDir = await mkdtemp(join(os.tmpdir(), 'mirabilis-retention-'));
  const storePath = join(tempDir, 'intelledger.json');
  const storage = createIntelLedgerStorage(storePath);

  try {
    await storage.ensureStore();

    const session = await storage.createSession('u-ret', 'Retention Session', 'desc');
    const interaction = await storage.ingestInteraction(session.id, 'text', 'legacy content', 'manual');
    const signal = (await storage.storeSignals(session.id, interaction.id, [{
      signal_type: 'risk',
      value: 'Legacy deployment risk',
      quote: 'Legacy deployment risk',
      confidence: 0.7,
      source_ref: 'manual',
      evidence_text: 'legacy evidence'
    }]))[0];

    await storage.replaceActionsForSession(session.id, [
      {
        title: 'Legacy Action',
        owner: 'team',
        due_date: null,
        rationale: 'follow up'
      }
    ], 'auto_extract');

    await storage.updateSessionRetentionPolicy(session.id, { retention_days: 7, pii_mode: 'strict' });

    const ninetyDaysAhead = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
    const result = await storage.runRetentionSweep(session.id, { now: ninetyDaysAhead });
    assert.equal(result.retention_days, 7);
    assert.equal(result.purged.interactions, 1);
    assert.equal(result.purged.signals, 1);
    assert.equal(result.purged.actions, 1);

    const [interactions, signals, actions, updatedSession] = await Promise.all([
      storage.getInteractions(session.id),
      storage.getSignalsBySession(session.id),
      storage.getActionsBySession(session.id),
      storage.getSession(session.id)
    ]);

    assert.equal(interactions.length, 0);
    assert.equal(signals.length, 0);
    assert.equal(actions.length, 0);
    assert.equal(updatedSession.pii_mode, 'strict');
    assert.equal(updatedSession.retention_days, 7);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('retention sweep hashes stale strict PII records when configured', async () => {
  const tempDir = await mkdtemp(join(os.tmpdir(), 'mirabilis-retention-hash-'));
  const storePath = join(tempDir, 'intelledger.json');
  const storage = createIntelLedgerStorage(storePath);

  try {
    await storage.ensureStore();

    const session = await storage.createSession('u-ret-hash', 'Retention Hash Session', 'desc');
    const interaction = await storage.ingestInteraction(session.id, 'text', 'Call me at 415-555-0100', 'manual');
    await storage.storeSignals(session.id, interaction.id, [{
      signal_type: 'ask',
      value: 'Call me at 415-555-0100',
      quote: 'Call me at 415-555-0100',
      confidence: 0.8,
      owner: 'John Doe'
    }]);

    await storage.updateSessionRetentionPolicy(session.id, {
      retention_days: 7,
      pii_mode: 'strict',
      pii_retention_action: 'hash'
    });

    const ninetyDaysAhead = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
    const result = await storage.runRetentionSweep(session.id, { now: ninetyDaysAhead });

    assert.equal(result.pii_retention_action, 'hash');
    assert.equal(result.hashed.interactions, 1);
    assert.equal(result.hashed.signals, 1);
    assert.equal(result.purged.interactions, 0);
    assert.equal(result.purged.signals, 0);

    const [interactions, signals] = await Promise.all([
      storage.getInteractions(session.id),
      storage.getSignalsBySession(session.id)
    ]);

    assert.equal(interactions.length, 1);
    assert.equal(String(interactions[0].raw_content || '').startsWith('sha256:'), true);
    assert.equal(signals.length, 1);
    assert.equal(String(signals[0].value || '').startsWith('sha256:'), true);
    assert.equal(String(signals[0].quote || '').startsWith('sha256:'), true);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
