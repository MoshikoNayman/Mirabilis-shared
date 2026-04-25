import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import os from 'node:os';
import { createIntelLedgerStorage } from './storage/intelLedger.js';

test('listSessions exposes latest signal and synthesis prompt provenance', async () => {
  const tempDir = await mkdtemp(join(os.tmpdir(), 'mirabilis-session-provenance-'));
  const storePath = join(tempDir, 'intelledger.json');
  const storage = createIntelLedgerStorage(storePath);

  try {
    await storage.ensureStore();

    const session = await storage.createSession('u1', 'Prompt provenance', '', { tenantId: 'tenant-a' });

    await storage.storeSignals(session.id, 'interaction-1', [
      { type: 'risk', value: 'Initial risk signal', quote: 'Initial risk signal' }
    ], {
      promptProfile: 'signal_extraction',
      promptVersion: 'signal-extraction-v1'
    });

    await storage.storeSignals(session.id, 'interaction-2', [
      { type: 'decision', value: 'Latest decision signal', quote: 'Latest decision signal' }
    ], {
      promptProfile: 'signal_extraction',
      promptVersion: 'signal-extraction-v2'
    });

    await storage.storeSynthesis(
      session.id,
      'summary',
      'Session synthesis content',
      'test-model',
      42,
      {
        promptProfile: 'session_synthesis',
        promptVersion: 'session-synthesis-v3'
      }
    );

    const sessions = await storage.listSessions('u1', { tenantId: 'tenant-a' });
    assert.equal(sessions.length, 1);

    const listed = sessions[0];
    assert.equal(listed.latest_signal_prompt_profile, 'signal_extraction');
    assert.equal(listed.latest_signal_prompt_version, 'signal-extraction-v2');
    assert.equal(listed.latest_synthesis_prompt_profile, 'session_synthesis');
    assert.equal(listed.latest_synthesis_prompt_version, 'session-synthesis-v3');
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
