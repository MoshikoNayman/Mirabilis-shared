import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import os from 'node:os';
import { createIntelLedgerStorage } from './storage/intelLedger.js';

test('upsertEntitiesForInteraction creates canonical entities and links', async () => {
  const tempDir = await mkdtemp(join(os.tmpdir(), 'mirabilis-identity-graph-'));
  const storePath = join(tempDir, 'intelledger.json');
  const storage = createIntelLedgerStorage(storePath);

  try {
    await storage.ensureStore();
    const session = await storage.createSession('identity-user', 'Acme Deal Discovery', 'Identity graph test');
    const interaction = await storage.ingestInteraction(
      session.id,
      'file',
      'Jane Doe committed to send updates. Speaker 1: John Smith raised risk.',
      'call-notes.txt'
    );

    const signals = await storage.storeSignals(session.id, interaction.id, [
      {
        type: 'commitment',
        value: 'Jane Doe will send updates by tomorrow',
        quote: 'Jane Doe committed to send updates',
        owner: 'Jane Doe',
        speaker: 'John Smith',
        confidence: 0.86
      }
    ], {
      extractorVersion: 'identity-test-v1'
    });

    const graph = await storage.upsertEntitiesForInteraction(session.id, interaction.id, signals);
    assert.ok(Array.isArray(graph.entities) && graph.entities.length > 0);
    assert.ok(Array.isArray(graph.links) && graph.links.length > 0);

    const entities = await storage.getEntitiesBySession(session.id);
    const byType = (type) => entities.filter((item) => item.entity_type === type);

    assert.ok(byType('account').some((entity) => entity.canonical_name === 'Acme Deal Discovery'));
    assert.ok(byType('thread').some((entity) => entity.canonical_name === 'call-notes.txt'));
    assert.ok(byType('attachment').some((entity) => entity.canonical_name === 'call-notes.txt'));
    assert.ok(byType('deal').some((entity) => entity.canonical_name === 'Acme Deal Discovery'));
    assert.ok(byType('person').some((entity) => entity.canonical_name === 'Jane Doe'));
    assert.ok(byType('person').some((entity) => entity.canonical_name === 'John Smith'));

    const links = await storage.getEntityLinksBySession(session.id);
    assert.ok(links.every((link) => link.interaction_id === interaction.id));
    assert.ok(links.some((link) => link.signal_id === signals[0].id));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
