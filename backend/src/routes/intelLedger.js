// backend/src/routes/intelLedger.js
// InteLedger API endpoints

const express = require('express');
const multer = require('multer');
const fs = require('fs');

module.exports = function createIntelLedgerRoutes(storage, extractionService) {
  const router = express.Router();
  const upload = multer({ storage: multer.memoryStorage() });

  // Session management
  router.post('/sessions', async (req, res) => {
    try {
      const { userId, title, description } = req.body;
      const session = await storage.createSession(userId, title, description);
      res.json({ session });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/sessions', async (req, res) => {
    try {
      const { userId } = req.query;
      const sessions = await storage.listSessions(userId);
      res.json({ sessions });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/sessions/:sessionId', async (req, res) => {
    try {
      const session = await storage.getSession(req.params.sessionId);
      if (!session) return res.status(404).json({ error: 'Not found' });
      res.json({ session });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Ingestion endpoints
  router.post('/sessions/:sessionId/ingest/text', async (req, res) => {
    try {
      const { sessionId } = req.params;
      const { content, sourceName } = req.body;

      const interaction = await storage.ingestInteraction(
        sessionId,
        'text',
        content,
        sourceName || 'manual_input'
      );

      // Auto-extract signals
      const signals = await extractionService.extractSignals(content);
      const stored = await storage.storeSignals(sessionId, interaction.id, signals);

      // Mark extracted
      await storage.pool.query(
        `UPDATE intelledger_interactions SET extracted = TRUE WHERE id = $1`,
        [interaction.id]
      );

      res.json({ interaction, signals: stored });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/sessions/:sessionId/ingest/file', upload.single('file'), async (req, res) => {
    try {
      const { sessionId } = req.params;
      if (!req.file) return res.status(400).json({ error: 'No file' });

      const content = req.file.buffer.toString('utf-8');
      const interaction = await storage.ingestInteraction(
        sessionId,
        'file',
        content,
        req.file.originalname
      );

      // Auto-extract signals
      const signals = await extractionService.extractSignals(content);
      const stored = await storage.storeSignals(sessionId, interaction.id, signals);

      await storage.pool.query(
        `UPDATE intelledger_interactions SET extracted = TRUE WHERE id = $1`,
        [interaction.id]
      );

      res.json({ interaction, signals: stored });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Retrieval
  router.get('/sessions/:sessionId/interactions', async (req, res) => {
    try {
      const { sessionId } = req.params;
      const interactions = await storage.getInteractions(sessionId);
      res.json({ interactions });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/sessions/:sessionId/signals', async (req, res) => {
    try {
      const { sessionId } = req.params;
      const { type } = req.query;
      const signals = await storage.getSignalsBySession(sessionId, type);
      res.json({ signals });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Synthesis query
  router.post('/sessions/:sessionId/synthesize', async (req, res) => {
    try {
      const { sessionId } = req.params;
      const { query, synthesisType = 'pattern' } = req.body;

      // Hybrid search: signals + interactions + vector
      const signals = await storage.getSignalsBySession(sessionId);
      const interactions = await storage.getInteractions(sessionId);

      const synthesis = {
        query,
        signalsByType: groupBy(signals, 'signal_type'),
        interactions: interactions.length,
        nextSteps: generateNextSteps(signals),
        gaps: detectGaps(signals),
        observations: [] // AI-generated via synthesis route
      };

      // Store synthesis
      const stored = await storage.storeSynthesis(
        sessionId,
        synthesisType,
        JSON.stringify(synthesis),
        'reasoning_v1',
        0
      );

      res.json({ synthesis: stored });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/sessions/:sessionId/synthesis', async (req, res) => {
    try {
      const { sessionId } = req.params;
      const { type } = req.query;
      const syntheses = await storage.getSynthesisBySession(sessionId, type);
      res.json({ syntheses });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Batch operations
  router.post('/sessions/:sessionId/extract-pending', async (req, res) => {
    try {
      const { sessionId } = req.params;
      const interactions = await storage.getInteractions(sessionId);
      const pending = interactions.filter(i => !i.extracted);

      const results = await extractionService.batchExtract(pending, storage);
      res.json({ processed: results.length, results });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};

// Helpers
function groupBy(arr, key) {
  return arr.reduce((acc, item) => {
    (acc[item[key]] = acc[item[key]] || []).push(item);
    return acc;
  }, {});
}

function generateNextSteps(signals) {
  // Simple heuristic: commitments + timelines = action items
  const commitments = signals.filter(s => s.signal_type === 'commitment');
  const timelines = signals.filter(s => s.signal_type === 'timeline');
  return { commitments: commitments.length, timelines: timelines.length };
}

function detectGaps(signals) {
  // Identify what's missing: risks without mitigations, opportunities without owners, etc.
  const gaps = [];
  const risks = signals.filter(s => s.signal_type === 'risk');
  const stakeholders = signals.filter(s => s.signal_type === 'stakeholder');

  if (risks.length > 0 && stakeholders.length < 2) {
    gaps.push('High-risk signals but limited stakeholder context');
  }

  return gaps;
}
