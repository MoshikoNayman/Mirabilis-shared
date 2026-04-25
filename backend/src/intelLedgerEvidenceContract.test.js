import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import os from 'node:os';
import { createIntelLedgerStorage } from './storage/intelLedger.js';

test('storeSignals persists strict evidence fields for each signal', async () => {
  const tempDir = await mkdtemp(join(os.tmpdir(), 'mirabilis-evidence-contract-'));
  const storePath = join(tempDir, 'intelledger.json');
  const storage = createIntelLedgerStorage(storePath);

  try {
    await storage.ensureStore();

    const session = await storage.createSession('evidence-user', 'Evidence Contract', 'Ensure strict evidence fields');
    const interaction = await storage.ingestInteraction(
      session.id,
      'note',
      'Customer asked for outage resolution by tomorrow.',
      'manual'
    );

    const stored = await storage.storeSignals(session.id, interaction.id, [
      {
        type: 'commitment',
        value: 'Resolve outage by tomorrow',
        quote: '',
        confidence: 5,
        owner: 'Ops Team'
      }
    ], {
      extractorVersion: 'test-extractor-v1'
    });

    assert.equal(stored.length, 1);
    const signal = stored[0];

    assert.equal(signal.signal_type, 'commitment');
    assert.equal(signal.value, 'Resolve outage by tomorrow');
    assert.equal(signal.quote, 'Resolve outage by tomorrow');
    assert.equal(signal.source_id, interaction.id);
    assert.equal(signal.extractor_version, 'test-extractor-v1');
    assert.ok(typeof signal.extracted_at === 'string' && signal.extracted_at.length > 0);
    assert.equal(signal.confidence, 0.99);

    assert.deepEqual(signal.evidence, {
      quote: 'Resolve outage by tomorrow',
      source_id: interaction.id,
      timestamp: signal.extracted_at,
      confidence: 0.99,
      extractor_version: 'test-extractor-v1'
    });

    const fetched = await storage.getSignalsBySession(session.id);
    assert.equal(fetched.length, 1);
    assert.equal(fetched[0].source_id, interaction.id);
    assert.equal(fetched[0].extractor_version, 'test-extractor-v1');
    assert.ok(fetched[0].evidence);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
