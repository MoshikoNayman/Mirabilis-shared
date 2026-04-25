import { createHmac } from 'node:crypto';

export function shouldSuppressReminder(action, minIntervalMs, nowMs = Date.now()) {
  const interval = Math.max(0, Number(minIntervalMs || 0));
  const lastRemindedAt = action?.last_reminded_at ? new Date(action.last_reminded_at).getTime() : NaN;
  if (!Number.isFinite(lastRemindedAt)) return false;
  return (nowMs - lastRemindedAt) < interval;
}

export function buildReminderWebhookHeaders(payloadBody, secret, timestamp = new Date().toISOString()) {
  const headers = { 'Content-Type': 'application/json' };
  const normalizedSecret = String(secret || '');

  if (!normalizedSecret) {
    return { headers, timestamp: null, signature: null };
  }

  const body = typeof payloadBody === 'string' ? payloadBody : JSON.stringify(payloadBody || {});
  const signingInput = `${timestamp}.${body}`;
  const signatureDigest = createHmac('sha256', normalizedSecret)
    .update(signingInput)
    .digest('hex');
  const signature = `sha256=${signatureDigest}`;

  headers['x-mirabilis-reminder-timestamp'] = timestamp;
  headers['x-mirabilis-reminder-signature'] = signature;

  return { headers, timestamp, signature };
}
