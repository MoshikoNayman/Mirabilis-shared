import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import os from 'node:os';
import { createIntelLedgerStorage } from './storage/intelLedger.js';

test('signal quality metrics reflect accept/reject feedback loop', async () => {
  const tempDir = await mkdtemp(join(os.tmpdir(), 'mirabilis-quality-metrics-'));
  const storePath = join(tempDir, 'intelledger.json');
  const storage = createIntelLedgerStorage(storePath);

  try {
    await storage.ensureStore();
    const session = await storage.createSession('quality-user', 'Quality Session', 'Feedback metrics test');
    const interaction = await storage.ingestInteraction(session.id, 'text', 'Please resolve outage by tomorrow.', 'manual');

    const signals = await storage.storeSignals(session.id, interaction.id, [
      {
        type: 'commitment',
        value: 'Resolve outage by tomorrow',
        quote: 'Please resolve outage by tomorrow.',
        confidence: 0.85
      },
      {
        type: 'risk',
        value: 'Outage risk is active',
        quote: 'outage risk is active',
        confidence: 0.7
      }
    ], {
      extractorVersion: 'quality-test-v1'
    });

    const acceptFeedback = await storage.addSignalFeedback(session.id, signals[0].id, 'accept', 'Good signal');
    const rejectFeedback = await storage.addSignalFeedback(session.id, signals[1].id, 'reject', 'Not useful');

    assert.equal(acceptFeedback.verdict, 'accept');
    assert.equal(rejectFeedback.verdict, 'reject');

    const metrics = await storage.getSignalQualityMetrics(session.id, { windowDays: 30 });
    assert.equal(metrics.signal_count, 2);
    assert.equal(metrics.feedback_count, 2);
    assert.equal(metrics.accepted_count, 1);
    assert.equal(metrics.rejected_count, 1);
    assert.equal(metrics.useful_insight_rate, 0.5);
    assert.equal(metrics.extraction_precision_proxy, 0.5);
    assert.ok(metrics.evidence_coverage_rate !== null && metrics.evidence_coverage_rate > 0);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
