import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { createHmac } from 'node:crypto';
import os from 'node:os';

async function waitForServer(baseUrl, timeoutMs = 12000) {
  const startedAt = Date.now();
  while ((Date.now() - startedAt) < timeoutMs) {
    try {
      const res = await fetch(`${baseUrl}/api/intelledger/reminders/status`);
      if (res.ok) return;
    } catch {
      // keep retrying until timeout
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out waiting for backend at ${baseUrl}`);
}

async function requestJson(url, init) {
  const res = await fetch(url, init);
  const text = await res.text();
  let payload = {};
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { raw: text };
    }
  }
  if (!res.ok) {
    throw new Error(`Request failed (${res.status}) for ${url}: ${text.slice(0, 400)}`);
  }
  return payload;
}

async function waitForReminderDispatch(baseUrl, sessionId, actionId, timeoutMs = 22000) {
  const startedAt = Date.now();
  while ((Date.now() - startedAt) < timeoutMs) {
    const payload = await requestJson(`${baseUrl}/api/intelledger/sessions/${sessionId}/actions`);
    const actions = Array.isArray(payload?.actions) ? payload.actions : [];
    const target = actions.find((action) => action.id === actionId);
    const historyCount = Array.isArray(target?.reminder_history) ? target.reminder_history.length : 0;
    if (target?.last_reminded_at && historyCount > 0) {
      return target;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Timed out waiting for reminder dispatch on action ${actionId}`);
}

async function waitForSuppressedDispatch(baseUrl, sessionId, actionId, timeoutMs = 26000) {
  const startedAt = Date.now();
  while ((Date.now() - startedAt) < timeoutMs) {
    const statusPayload = await requestJson(`${baseUrl}/api/intelledger/reminders/status`);
    const dispatches = Array.isArray(statusPayload?.worker?.dispatches) ? statusPayload.worker.dispatches : [];
    const suppressed = dispatches.find((entry) => (
      entry?.session_id === sessionId &&
      entry?.action_id === actionId &&
      entry?.status === 'suppressed'
    ));

    if (suppressed && Number(statusPayload?.worker?.last_cycle_suppressed_count || 0) > 0) {
      return { statusPayload, suppressed };
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Timed out waiting for suppressed reminder dispatch on action ${actionId}`);
}

async function waitForFailedReminderDispatch(baseUrl, sessionId, actionId, timeoutMs = 24000) {
  const startedAt = Date.now();
  while ((Date.now() - startedAt) < timeoutMs) {
    const payload = await requestJson(`${baseUrl}/api/intelledger/sessions/${sessionId}/actions`);
    const actions = Array.isArray(payload?.actions) ? payload.actions : [];
    const target = actions.find((action) => action.id === actionId);
    const historyCount = Array.isArray(target?.reminder_history) ? target.reminder_history.length : 0;
    if (target?.last_reminder_status === 'failed' && historyCount > 0) {
      return target;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Timed out waiting for failed reminder dispatch on action ${actionId}`);
}

async function waitForWebhookCapture(getEvent, timeoutMs = 24000) {
  const startedAt = Date.now();
  while ((Date.now() - startedAt) < timeoutMs) {
    const event = getEvent();
    if (event) return event;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Timed out waiting for webhook capture event');
}

test('integration: reminders status exposes worker hardening fields', async (t) => {
  const tempDataDir = await mkdtemp(join(os.tmpdir(), 'mirabilis-it-ledger-'));
  const port = 41200 + Math.floor(Math.random() * 400);
  const baseUrl = `http://127.0.0.1:${port}`;

  let stderr = '';
  const child = spawn('node', ['src/server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      DATA_DIR: tempDataDir,
      INTELLEDGER_REMINDER_WORKER_ENABLED: '1',
      INTELLEDGER_REMINDER_WORKER_INTERVAL_MS: '60000',
      INTELLEDGER_REMINDER_MIN_INTERVAL_MS: '120000',
      INTELLEDGER_REMINDER_WEBHOOK_URL: 'http://127.0.0.1:9/reminders',
      INTELLEDGER_REMINDER_WEBHOOK_SECRET: 'integration-secret'
    },
    stdio: ['ignore', 'ignore', 'pipe']
  });

  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });

  t.after(async () => {
    if (!child.killed) {
      child.kill('SIGTERM');
      await new Promise((resolve) => setTimeout(resolve, 200));
      if (!child.killed) child.kill('SIGKILL');
    }
    await rm(tempDataDir, { recursive: true, force: true });
  });

  await waitForServer(baseUrl);

  const res = await fetch(`${baseUrl}/api/intelledger/reminders/status`);
  if (!res.ok) {
    throw new Error(`Status endpoint failed (${res.status})\n${stderr}`);
  }

  const payload = await res.json();
  assert.equal(payload?.worker?.enabled, true);
  assert.equal(payload?.worker?.interval_ms, 60000);
  assert.equal(payload?.worker?.min_interval_ms, 120000);
  assert.equal(payload?.worker?.webhook_configured, true);
  assert.equal(payload?.worker?.webhook_signing_enabled, true);
  assert.ok(Array.isArray(payload?.worker?.dispatches));
  assert.ok(typeof payload?.worker?.last_cycle_suppressed_count === 'number');
  assert.ok(typeof payload?.worker?.last_cycle_processed_count === 'number');
  assert.ok(typeof payload?.due_preview_count === 'number');

  const opsRes = await fetch(`${baseUrl}/api/intelledger/ops/status`);
  if (!opsRes.ok) {
    throw new Error(`Ops status endpoint failed (${opsRes.status})\n${stderr}`);
  }

  const opsPayload = await opsRes.json();
  assert.equal(opsPayload?.status, 'ok');
  assert.ok(typeof opsPayload?.service?.started_at === 'string');
  assert.ok(typeof opsPayload?.service?.uptime_ms === 'number');
  assert.ok(opsPayload.service.uptime_ms >= 0);
  assert.equal(typeof opsPayload?.service?.pid, 'number');
  assert.equal(typeof opsPayload?.service?.node_version, 'string');
  assert.ok(typeof opsPayload?.service?.memory?.rss === 'number');
  assert.ok(typeof opsPayload?.worker?.total_cycles === 'number');
  assert.ok(typeof opsPayload?.worker?.total_processed_count === 'number');
  assert.ok(typeof opsPayload?.worker?.total_suppressed_count === 'number');
  assert.ok(typeof opsPayload?.worker?.total_error_count === 'number');
});

test('integration: manual reminder run endpoint executes one cycle deterministically', async (t) => {
  const tempDataDir = await mkdtemp(join(os.tmpdir(), 'mirabilis-it-reminder-manual-run-'));
  const port = 41050 + Math.floor(Math.random() * 300);
  const baseUrl = `http://127.0.0.1:${port}`;

  let stderr = '';
  const child = spawn('node', ['src/server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      DATA_DIR: tempDataDir,
      INTELLEDGER_REMINDER_WORKER_ENABLED: '0',
      INTELLEDGER_REMINDER_WORKER_BATCH_SIZE: '10'
    },
    stdio: ['ignore', 'ignore', 'pipe']
  });

  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });

  t.after(async () => {
    if (!child.killed) {
      child.kill('SIGTERM');
      await new Promise((resolve) => setTimeout(resolve, 200));
      if (!child.killed) child.kill('SIGKILL');
    }
    await rm(tempDataDir, { recursive: true, force: true });
  });

  await waitForServer(baseUrl);

  const createSessionPayload = await requestJson(`${baseUrl}/api/intelledger/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: 'integration-reminder-manual', title: 'Manual run lifecycle' })
  });
  const sessionId = createSessionPayload?.session?.id;
  assert.ok(sessionId, `Session id missing in response. stderr=${stderr}`);

  await requestJson(`${baseUrl}/api/intelledger/sessions/${sessionId}/ingest/text`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: 'Please ship emergency patch by 2026-04-20.' })
  });

  const actionsPayload = await requestJson(`${baseUrl}/api/intelledger/sessions/${sessionId}/actions`);
  const actions = Array.isArray(actionsPayload?.actions) ? actionsPayload.actions : [];
  assert.ok(actions.length > 0, `Expected at least one action after ingest. stderr=${stderr}`);

  const actionId = actions[0]?.id;
  assert.ok(actionId, 'Action id missing after ingest.');

  await requestJson(`${baseUrl}/api/intelledger/sessions/${sessionId}/actions/${actionId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ due_date: '2026-04-20', status: 'open', priority: 'high' })
  });

  const runPayload = await requestJson(`${baseUrl}/api/intelledger/reminders/run`, {
    method: 'POST'
  });

  assert.equal(runPayload?.trigger, 'manual');
  assert.equal(runPayload?.cycle?.ok, true);
  assert.equal(runPayload?.cycle?.trigger, 'manual');
  assert.ok(Number(runPayload?.cycle?.processed_count || 0) > 0);
  assert.equal(runPayload?.worker?.last_trigger, 'manual');

  const updatedActionsPayload = await requestJson(`${baseUrl}/api/intelledger/sessions/${sessionId}/actions`);
  const updatedActions = Array.isArray(updatedActionsPayload?.actions) ? updatedActionsPayload.actions : [];
  const updatedAction = updatedActions.find((item) => item.id === actionId) || {};
  assert.equal(updatedAction.last_reminder_status, 'simulated');
  assert.equal(updatedAction.last_reminder_channel, 'log');
  assert.ok(Array.isArray(updatedAction.reminder_history) && updatedAction.reminder_history.length > 0);
});

test('integration: worker dispatch updates action reminder metadata', async (t) => {
  const tempDataDir = await mkdtemp(join(os.tmpdir(), 'mirabilis-it-reminder-dispatch-'));
  const port = 41600 + Math.floor(Math.random() * 400);
  const baseUrl = `http://127.0.0.1:${port}`;

  let stderr = '';
  const child = spawn('node', ['src/server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      DATA_DIR: tempDataDir,
      INTELLEDGER_REMINDER_WORKER_ENABLED: '1',
      INTELLEDGER_REMINDER_WORKER_INTERVAL_MS: '10000',
      INTELLEDGER_REMINDER_WORKER_BATCH_SIZE: '10'
    },
    stdio: ['ignore', 'ignore', 'pipe']
  });

  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });

  t.after(async () => {
    if (!child.killed) {
      child.kill('SIGTERM');
      await new Promise((resolve) => setTimeout(resolve, 200));
      if (!child.killed) child.kill('SIGKILL');
    }
    await rm(tempDataDir, { recursive: true, force: true });
  });

  await waitForServer(baseUrl);

  const createSessionPayload = await requestJson(`${baseUrl}/api/intelledger/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: 'integration-reminder-worker', title: 'Worker dispatch lifecycle' })
  });
  const sessionId = createSessionPayload?.session?.id;
  assert.ok(sessionId, `Session id missing in response. stderr=${stderr}`);

  await requestJson(`${baseUrl}/api/intelledger/sessions/${sessionId}/ingest/text`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: 'Please ship emergency patch by 2026-04-20.' })
  });

  const actionsPayload = await requestJson(`${baseUrl}/api/intelledger/sessions/${sessionId}/actions`);
  const actions = Array.isArray(actionsPayload?.actions) ? actionsPayload.actions : [];
  assert.ok(actions.length > 0, `Expected at least one action after ingest. stderr=${stderr}`);

  const firstAction = actions[0];
  const actionId = firstAction.id;
  assert.ok(actionId, 'Action id missing after ingest.');

  const patchPayload = await requestJson(`${baseUrl}/api/intelledger/sessions/${sessionId}/actions/${actionId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ due_date: '2026-04-20', status: 'open', priority: 'high' })
  });

  const patchedAction = patchPayload?.action || {};
  assert.equal(patchedAction.is_overdue, true);
  const beforeNextReminderAt = patchedAction.next_reminder_at || null;

  const updatedAction = await waitForReminderDispatch(baseUrl, sessionId, actionId);
  assert.equal(updatedAction.last_reminder_channel, 'log');
  assert.equal(updatedAction.last_reminder_status, 'simulated');
  assert.ok(Array.isArray(updatedAction.reminder_history) && updatedAction.reminder_history.length > 0);
  assert.ok(updatedAction.next_reminder_at);
  if (beforeNextReminderAt) {
    assert.notEqual(updatedAction.next_reminder_at, beforeNextReminderAt);
  }
});

test('integration: cooldown suppression prevents repeat reminder mutation', async (t) => {
  const tempDataDir = await mkdtemp(join(os.tmpdir(), 'mirabilis-it-reminder-suppression-'));
  const port = 42050 + Math.floor(Math.random() * 400);
  const baseUrl = `http://127.0.0.1:${port}`;

  let stderr = '';
  const child = spawn('node', ['src/server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      DATA_DIR: tempDataDir,
      INTELLEDGER_REMINDER_WORKER_ENABLED: '1',
      INTELLEDGER_REMINDER_WORKER_INTERVAL_MS: '10000',
      INTELLEDGER_REMINDER_MIN_INTERVAL_MS: '600000',
      INTELLEDGER_REMINDER_WORKER_BATCH_SIZE: '10'
    },
    stdio: ['ignore', 'ignore', 'pipe']
  });

  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });

  t.after(async () => {
    if (!child.killed) {
      child.kill('SIGTERM');
      await new Promise((resolve) => setTimeout(resolve, 200));
      if (!child.killed) child.kill('SIGKILL');
    }
    await rm(tempDataDir, { recursive: true, force: true });
  });

  await waitForServer(baseUrl);

  const createSessionPayload = await requestJson(`${baseUrl}/api/intelledger/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: 'integration-reminder-suppression', title: 'Worker suppression lifecycle' })
  });
  const sessionId = createSessionPayload?.session?.id;
  assert.ok(sessionId, `Session id missing in response. stderr=${stderr}`);

  await requestJson(`${baseUrl}/api/intelledger/sessions/${sessionId}/ingest/text`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: 'Please ship emergency patch by 2026-04-20.' })
  });

  const actionsPayload = await requestJson(`${baseUrl}/api/intelledger/sessions/${sessionId}/actions`);
  const actions = Array.isArray(actionsPayload?.actions) ? actionsPayload.actions : [];
  assert.ok(actions.length > 0, `Expected at least one action after ingest. stderr=${stderr}`);

  const actionId = actions[0]?.id;
  assert.ok(actionId, 'Action id missing after ingest.');

  await requestJson(`${baseUrl}/api/intelledger/sessions/${sessionId}/actions/${actionId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ due_date: '2026-04-20', status: 'open', priority: 'high' })
  });

  const firstDispatchAction = await waitForReminderDispatch(baseUrl, sessionId, actionId);
  const firstHistoryCount = Array.isArray(firstDispatchAction?.reminder_history)
    ? firstDispatchAction.reminder_history.length
    : 0;
  assert.ok(firstHistoryCount > 0);
  const firstRemindedAt = firstDispatchAction.last_reminded_at;
  assert.ok(firstRemindedAt);

  const suppressionResult = await waitForSuppressedDispatch(baseUrl, sessionId, actionId);
  assert.equal(suppressionResult?.suppressed?.status, 'suppressed');
  assert.ok((suppressionResult?.suppressed?.error || '').includes('suppressed: min interval'));

  const finalActionsPayload = await requestJson(`${baseUrl}/api/intelledger/sessions/${sessionId}/actions`);
  const finalActions = Array.isArray(finalActionsPayload?.actions) ? finalActionsPayload.actions : [];
  const finalAction = finalActions.find((item) => item.id === actionId) || {};

  const finalHistoryCount = Array.isArray(finalAction?.reminder_history)
    ? finalAction.reminder_history.length
    : 0;
  assert.equal(finalHistoryCount, firstHistoryCount);
  assert.equal(finalAction.last_reminded_at, firstRemindedAt);
});

test('integration: webhook failure persists reminder error metadata', async (t) => {
  const tempDataDir = await mkdtemp(join(os.tmpdir(), 'mirabilis-it-reminder-webhook-failure-'));
  const port = 42450 + Math.floor(Math.random() * 400);
  const baseUrl = `http://127.0.0.1:${port}`;

  let stderr = '';
  const child = spawn('node', ['src/server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      DATA_DIR: tempDataDir,
      INTELLEDGER_REMINDER_WORKER_ENABLED: '1',
      INTELLEDGER_REMINDER_WORKER_INTERVAL_MS: '10000',
      INTELLEDGER_REMINDER_WORKER_BATCH_SIZE: '10',
      INTELLEDGER_REMINDER_WEBHOOK_URL: 'http://127.0.0.1:9/reminders'
    },
    stdio: ['ignore', 'ignore', 'pipe']
  });

  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });

  t.after(async () => {
    if (!child.killed) {
      child.kill('SIGTERM');
      await new Promise((resolve) => setTimeout(resolve, 200));
      if (!child.killed) child.kill('SIGKILL');
    }
    await rm(tempDataDir, { recursive: true, force: true });
  });

  await waitForServer(baseUrl);

  const createSessionPayload = await requestJson(`${baseUrl}/api/intelledger/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: 'integration-reminder-webhook-failure', title: 'Webhook failure lifecycle' })
  });
  const sessionId = createSessionPayload?.session?.id;
  assert.ok(sessionId, `Session id missing in response. stderr=${stderr}`);

  await requestJson(`${baseUrl}/api/intelledger/sessions/${sessionId}/ingest/text`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: 'Please ship emergency patch by 2026-04-20.' })
  });

  const actionsPayload = await requestJson(`${baseUrl}/api/intelledger/sessions/${sessionId}/actions`);
  const actions = Array.isArray(actionsPayload?.actions) ? actionsPayload.actions : [];
  assert.ok(actions.length > 0, `Expected at least one action after ingest. stderr=${stderr}`);

  const actionId = actions[0]?.id;
  assert.ok(actionId, 'Action id missing after ingest.');

  await requestJson(`${baseUrl}/api/intelledger/sessions/${sessionId}/actions/${actionId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ due_date: '2026-04-20', status: 'open', priority: 'high' })
  });

  const failedDispatchAction = await waitForFailedReminderDispatch(baseUrl, sessionId, actionId);
  assert.equal(failedDispatchAction.last_reminder_channel, 'webhook');
  assert.equal(failedDispatchAction.last_reminder_status, 'failed');
  assert.ok((failedDispatchAction.last_reminder_error || '').length > 0);
  assert.equal(failedDispatchAction.last_reminder_response_code, null);
  assert.ok(Array.isArray(failedDispatchAction.reminder_history) && failedDispatchAction.reminder_history.length > 0);

  const latestHistory = failedDispatchAction.reminder_history[failedDispatchAction.reminder_history.length - 1] || {};
  assert.equal(latestHistory.channel, 'webhook');
  assert.equal(latestHistory.status, 'failed');
  assert.equal(latestHistory.response_code, null);
  assert.ok((latestHistory.error || '').length > 0);
});

test('integration: signed webhook dispatch includes verifiable signature headers', async (t) => {
  const tempDataDir = await mkdtemp(join(os.tmpdir(), 'mirabilis-it-reminder-webhook-signing-'));
  const port = 42850 + Math.floor(Math.random() * 400);
  const baseUrl = `http://127.0.0.1:${port}`;
  const webhookSecret = 'integration-signing-secret';

  let latestWebhookEvent = null;
  const captureServer = createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      latestWebhookEvent = {
        method: req.method,
        url: req.url,
        headers: req.headers,
        body
      };
      res.statusCode = 202;
      res.setHeader('Content-Type', 'application/json');
      res.end('{"ok":true}');
    });
  });

  await new Promise((resolve, reject) => {
    captureServer.once('error', reject);
    captureServer.listen(0, '127.0.0.1', () => {
      captureServer.removeListener('error', reject);
      resolve();
    });
  });

  const captureAddress = captureServer.address();
  if (!captureAddress || typeof captureAddress === 'string') {
    throw new Error('Failed to bind webhook capture server');
  }
  const webhookUrl = `http://127.0.0.1:${captureAddress.port}/reminders`;

  let stderr = '';
  const child = spawn('node', ['src/server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      DATA_DIR: tempDataDir,
      INTELLEDGER_REMINDER_WORKER_ENABLED: '1',
      INTELLEDGER_REMINDER_WORKER_INTERVAL_MS: '10000',
      INTELLEDGER_REMINDER_WORKER_BATCH_SIZE: '10',
      INTELLEDGER_REMINDER_WEBHOOK_URL: webhookUrl,
      INTELLEDGER_REMINDER_WEBHOOK_SECRET: webhookSecret
    },
    stdio: ['ignore', 'ignore', 'pipe']
  });

  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });

  t.after(async () => {
    if (!child.killed) {
      child.kill('SIGTERM');
      await new Promise((resolve) => setTimeout(resolve, 200));
      if (!child.killed) child.kill('SIGKILL');
    }
    await new Promise((resolve) => captureServer.close(() => resolve()));
    await rm(tempDataDir, { recursive: true, force: true });
  });

  await waitForServer(baseUrl);

  const createSessionPayload = await requestJson(`${baseUrl}/api/intelledger/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: 'integration-reminder-webhook-signing', title: 'Webhook signing lifecycle' })
  });
  const sessionId = createSessionPayload?.session?.id;
  assert.ok(sessionId, `Session id missing in response. stderr=${stderr}`);

  await requestJson(`${baseUrl}/api/intelledger/sessions/${sessionId}/ingest/text`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: 'Please ship emergency patch by 2026-04-20.' })
  });

  const actionsPayload = await requestJson(`${baseUrl}/api/intelledger/sessions/${sessionId}/actions`);
  const actions = Array.isArray(actionsPayload?.actions) ? actionsPayload.actions : [];
  assert.ok(actions.length > 0, `Expected at least one action after ingest. stderr=${stderr}`);

  const actionId = actions[0]?.id;
  assert.ok(actionId, 'Action id missing after ingest.');

  await requestJson(`${baseUrl}/api/intelledger/sessions/${sessionId}/actions/${actionId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ due_date: '2026-04-20', status: 'open', priority: 'high' })
  });

  const webhookEvent = await waitForWebhookCapture(() => latestWebhookEvent);
  assert.equal(webhookEvent.method, 'POST');
  assert.equal(webhookEvent.url, '/reminders');

  const timestamp = webhookEvent.headers['x-mirabilis-reminder-timestamp'];
  const signature = webhookEvent.headers['x-mirabilis-reminder-signature'];
  assert.ok(typeof timestamp === 'string' && timestamp.length > 0);
  assert.ok(typeof signature === 'string' && signature.startsWith('sha256='));

  const expectedDigest = createHmac('sha256', webhookSecret)
    .update(`${timestamp}.${webhookEvent.body}`)
    .digest('hex');
  assert.equal(signature, `sha256=${expectedDigest}`);

  const parsedBody = JSON.parse(webhookEvent.body || '{}');
  assert.equal(parsedBody?.session_id, sessionId);
  assert.equal(parsedBody?.action_id, actionId);
});

test('integration: unsigned webhook dispatch omits signing headers', async (t) => {
  const tempDataDir = await mkdtemp(join(os.tmpdir(), 'mirabilis-it-reminder-webhook-unsigned-'));
  const port = 43250 + Math.floor(Math.random() * 400);
  const baseUrl = `http://127.0.0.1:${port}`;

  let latestWebhookEvent = null;
  const captureServer = createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      latestWebhookEvent = {
        method: req.method,
        url: req.url,
        headers: req.headers,
        body
      };
      res.statusCode = 202;
      res.setHeader('Content-Type', 'application/json');
      res.end('{"ok":true}');
    });
  });

  await new Promise((resolve, reject) => {
    captureServer.once('error', reject);
    captureServer.listen(0, '127.0.0.1', () => {
      captureServer.removeListener('error', reject);
      resolve();
    });
  });

  const captureAddress = captureServer.address();
  if (!captureAddress || typeof captureAddress === 'string') {
    throw new Error('Failed to bind webhook capture server');
  }
  const webhookUrl = `http://127.0.0.1:${captureAddress.port}/reminders`;

  let stderr = '';
  const child = spawn('node', ['src/server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      DATA_DIR: tempDataDir,
      INTELLEDGER_REMINDER_WORKER_ENABLED: '1',
      INTELLEDGER_REMINDER_WORKER_INTERVAL_MS: '10000',
      INTELLEDGER_REMINDER_WORKER_BATCH_SIZE: '10',
      INTELLEDGER_REMINDER_WEBHOOK_URL: webhookUrl
    },
    stdio: ['ignore', 'ignore', 'pipe']
  });

  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });

  t.after(async () => {
    if (!child.killed) {
      child.kill('SIGTERM');
      await new Promise((resolve) => setTimeout(resolve, 200));
      if (!child.killed) child.kill('SIGKILL');
    }
    await new Promise((resolve) => captureServer.close(() => resolve()));
    await rm(tempDataDir, { recursive: true, force: true });
  });

  await waitForServer(baseUrl);

  const createSessionPayload = await requestJson(`${baseUrl}/api/intelledger/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: 'integration-reminder-webhook-unsigned', title: 'Webhook unsigned lifecycle' })
  });
  const sessionId = createSessionPayload?.session?.id;
  assert.ok(sessionId, `Session id missing in response. stderr=${stderr}`);

  await requestJson(`${baseUrl}/api/intelledger/sessions/${sessionId}/ingest/text`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: 'Please ship emergency patch by 2026-04-20.' })
  });

  const actionsPayload = await requestJson(`${baseUrl}/api/intelledger/sessions/${sessionId}/actions`);
  const actions = Array.isArray(actionsPayload?.actions) ? actionsPayload.actions : [];
  assert.ok(actions.length > 0, `Expected at least one action after ingest. stderr=${stderr}`);

  const actionId = actions[0]?.id;
  assert.ok(actionId, 'Action id missing after ingest.');

  await requestJson(`${baseUrl}/api/intelledger/sessions/${sessionId}/actions/${actionId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ due_date: '2026-04-20', status: 'open', priority: 'high' })
  });

  const webhookEvent = await waitForWebhookCapture(() => latestWebhookEvent);
  assert.equal(webhookEvent.method, 'POST');
  assert.equal(webhookEvent.url, '/reminders');
  assert.equal(webhookEvent.headers['x-mirabilis-reminder-signature'], undefined);
  assert.equal(webhookEvent.headers['x-mirabilis-reminder-timestamp'], undefined);

  const updatedAction = await waitForReminderDispatch(baseUrl, sessionId, actionId);
  assert.equal(updatedAction.last_reminder_channel, 'webhook');
  assert.equal(updatedAction.last_reminder_status, 'sent');
  assert.equal(updatedAction.last_reminder_response_code, 202);

  const latestHistory = updatedAction.reminder_history[updatedAction.reminder_history.length - 1] || {};
  assert.equal(latestHistory.channel, 'webhook');
  assert.equal(latestHistory.status, 'sent');
  assert.equal(latestHistory.response_code, 202);
});
