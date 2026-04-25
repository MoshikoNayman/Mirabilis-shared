import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { buildReminderWebhookHeaders, shouldSuppressReminder } from './intelLedgerReminderUtils.js';

test('shouldSuppressReminder returns false without last reminder timestamp', () => {
  const nowMs = Date.UTC(2026, 3, 25, 12, 0, 0);
  assert.equal(shouldSuppressReminder({}, 120000, nowMs), false);
  assert.equal(shouldSuppressReminder({ last_reminded_at: 'not-a-date' }, 120000, nowMs), false);
});

test('shouldSuppressReminder returns true when inside cooldown window', () => {
  const nowMs = Date.UTC(2026, 3, 25, 12, 0, 0);
  const lastRemindedAt = new Date(nowMs - 90000).toISOString();

  assert.equal(
    shouldSuppressReminder({ last_reminded_at: lastRemindedAt }, 120000, nowMs),
    true
  );
});

test('shouldSuppressReminder returns false at cooldown boundary', () => {
  const nowMs = Date.UTC(2026, 3, 25, 12, 0, 0);
  const lastRemindedAt = new Date(nowMs - 120000).toISOString();

  assert.equal(
    shouldSuppressReminder({ last_reminded_at: lastRemindedAt }, 120000, nowMs),
    false
  );
});

test('buildReminderWebhookHeaders returns content type only when secret missing', () => {
  const result = buildReminderWebhookHeaders('{"ok":true}', '');

  assert.deepEqual(result.headers, { 'Content-Type': 'application/json' });
  assert.equal(result.signature, null);
  assert.equal(result.timestamp, null);
});

test('buildReminderWebhookHeaders adds deterministic timestamp and signature', () => {
  const secret = 'test-secret';
  const timestamp = '2026-04-25T12:00:00.000Z';
  const payloadBody = '{"action_id":"a1","status":"open"}';

  const result = buildReminderWebhookHeaders(payloadBody, secret, timestamp);
  const expected = `sha256=${createHmac('sha256', secret).update(`${timestamp}.${payloadBody}`).digest('hex')}`;

  assert.equal(result.timestamp, timestamp);
  assert.equal(result.signature, expected);
  assert.equal(result.headers['x-mirabilis-reminder-timestamp'], timestamp);
  assert.equal(result.headers['x-mirabilis-reminder-signature'], expected);
  assert.equal(result.headers['Content-Type'], 'application/json');
});
