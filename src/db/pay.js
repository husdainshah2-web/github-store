const crypto = require('crypto');
const catalog = require('./faces');
const { assertTransition } = require('./paystate');
const { sha256, decryptSecret } = require('../utils/hash');
const { objectId } = require('../utils/ids');

function err(status, code, message) {
  const e = new Error(message);
  e.status = status;
  e.code = code;
  throw e;
}

async function loadPsp(apiId) {
  const rec = await catalog.readFace(apiId, 'secrets/psp.json');
  if (!rec || !rec.webhook_secret_enc) return null;
  return {
    name: rec.name || 'attached',
    webhook_secret: decryptSecret(rec.webhook_secret_enc),
    checkout_base: rec.checkout_base || null,
  };
}

async function setPsp(apiId, { name, webhook_secret, checkout_base }) {
  if (!webhook_secret) err(422, 'INVALID_REQUEST', 'webhook_secret required');
  const { encryptSecret } = require('../utils/hash');
  const rec = {
    name: name || 'attached',
    checkout_base: checkout_base || null,
    webhook_secret_enc: encryptSecret(webhook_secret),
    updated_at: catalog.nowIso(),
  };
  await catalog.writeFace(apiId, 'set psp secret', [{ path: 'secrets/psp.json', content: rec }]);
  return { ok: true, name: rec.name, configured: true };
}

function hashKey(raw) {
  return sha256(Buffer.from(String(raw || '')));
}

async function sumItems(apiId, items) {
  if (!Array.isArray(items) || !items.length) err(422, 'AMOUNT_SERVER_OWNED', 'items[] required; client amount is ignored');
  let total = 0;
  const snapshot = [];
  for (const it of items) {
    const id = String(it.id || it.product_id || '');
    const qty = Math.max(1, parseInt(it.qty || 1, 10));
    const product = await catalog.readFace(apiId, `payments/products/${id}.json`);
    if (!product || typeof product.amount_minor !== 'number') {
      err(422, 'PRODUCT_NOT_FOUND', 'Unknown product ' + id + ' — create it first via PUT /v1/pay/products/:id');
    }
    const line = product.amount_minor * qty;
    total += line;
    snapshot.push({ id, qty, amount_minor: product.amount_minor, line });
  }
  return { amount_minor: total, currency: 'PKR', snapshot };
}

async function putProduct(apiId, id, { name, amount_minor, currency }) {
  const rec = {
    id: String(id),
    name: String(name || id),
    amount_minor: Number(amount_minor),
    currency: currency || 'PKR',
    updated_at: catalog.nowIso(),
  };
  if (!Number.isFinite(rec.amount_minor) || rec.amount_minor < 1) err(422, 'INVALID_REQUEST', 'amount_minor required');
  await catalog.writeFace(apiId, 'product ' + id, [{ path: `payments/products/${id}.json`, content: rec }]);
  return rec;
}

async function createIntent(apiId, { items, order_id, idempotencyKey }) {
  if (!idempotencyKey) err(422, 'IDEMPOTENCY_REQUIRED', 'Idempotency-Key header required');
  const keyHash = hashKey(idempotencyKey);
  const idempPath = `payments/idempotency/${keyHash.slice(0, 32)}.json`;
  const existing = await catalog.readFace(apiId, idempPath);
  const reqHash = sha256(Buffer.from(JSON.stringify({ items, order_id })));
  if (existing) {
    if (existing.request_hash !== reqHash) err(409, 'IDEMPOTENCY_KEY_REUSE', 'Same key, different request');
    const prev = await catalog.readFace(apiId, `payments/intents/${existing.intent_id}.json`);
    return { idempotent: true, intent: prev };
  }
  const priced = await sumItems(apiId, items);
  const intent_id = 'int_' + objectId();
  const oid = String(order_id || 'ord_' + objectId());
  const psp = await loadPsp(apiId);
  const intent = {
    intent_id,
    order_id: oid,
    currency: priced.currency,
    amount_minor: priced.amount_minor,
    pricing_version: 3,
    items: priced.snapshot,
    status: 'PENDING',
    _version: 1,
    created_at: catalog.nowIso(),
    expires_at: new Date(Date.now() + 15 * 24 * 3600 * 1000).toISOString(),
    psp_configured: Boolean(psp),
    checkout_url: psp && psp.checkout_base
      ? String(psp.checkout_base).replace(/\/$/, '') + '/' + intent_id
      : null,
  };
  const order = {
    order_id: oid,
    intent_id,
    status: 'PENDING',
    amount_minor: intent.amount_minor,
    currency: intent.currency,
    created_at: intent.created_at,
  };
  const event = {
    type: 'PAYMENT_CREATED',
    intent_id,
    order_id: oid,
    at: catalog.nowIso(),
  };
  await catalog.writeFace(apiId, 'pay intent ' + intent_id, [
    { path: `payments/intents/${intent_id}.json`, content: intent },
    { path: `payments/orders/${oid}.json`, content: order },
    { path: `payments/events/${intent_id}_created.json`, content: event },
    { path: idempPath, content: { key_hash: keyHash, request_hash: reqHash, intent_id, created_at: catalog.nowIso(), expires_at: new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString() } },
  ]);
  return { idempotent: false, intent };
}

function hmacHex(secret, raw) {
  return crypto.createHmac('sha256', secret).update(raw).digest('hex');
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

async function handleWebhook(apiId, rawBuf, headers) {
  const psp = await loadPsp(apiId);
  if (!psp) err(401, 'REJECTED', 'rejected');
  const sig = String(headers['x-gitdb-signature'] || headers['x-webhook-signature'] || '').replace(/^sha256=/, '');
  const expected = hmacHex(psp.webhook_secret, rawBuf);
  if (!sig || !safeEqual(sig, expected)) err(401, 'REJECTED', 'rejected');
  const ts = parseInt(headers['x-gitdb-timestamp'] || headers['x-webhook-timestamp'] || '0', 10);
  if (ts && Math.abs(Date.now() / 1000 - ts) > 300) err(401, 'WEBHOOK_EXPIRED', 'Timestamp window exceeded');
  let body;
  try { body = JSON.parse(rawBuf.toString('utf8')); } catch { err(400, 'INVALID_JSON', 'Webhook body is not JSON'); }
  const event_id = String(body.event_id || body.id || '');
  if (!event_id) err(422, 'INVALID_REQUEST', 'event_id required');
  const seen = await catalog.readFace(apiId, `payments/events/${event_id}.json`);
  if (seen) return { duplicate: true, event_id, status: seen.status || 'ignored' };
  const intent_id = String(body.intent_id || body.reference || '');
  const intent = await catalog.readFace(apiId, `payments/intents/${intent_id}.json`);
  if (!intent) err(404, 'NOT_FOUND', 'Intent not found');
  if (Number(body.amount_minor) !== Number(intent.amount_minor)) err(409, 'AMOUNT_MISMATCH', 'Webhook amount != intent');
  if (body.currency && body.currency !== intent.currency) err(409, 'CURRENCY_MISMATCH', 'Webhook currency != intent');
  const next = String(body.status || '').toUpperCase();
  if (!['PAID', 'FAILED', 'CANCELLED', 'AUTHORIZED'].includes(next)) err(422, 'INVALID_STATUS', 'status must be PAID|FAILED|CANCELLED|AUTHORIZED');
  assertTransition(intent.status, next);
  intent.status = next;
  intent._version = (intent._version || 1) + 1;
  intent.psp_reference = body.psp_reference || body.reference || null;
  intent.updated_at = catalog.nowIso();
  const order = (await catalog.readFace(apiId, `payments/orders/${intent.order_id}.json`)) || { order_id: intent.order_id };
  order.status = next;
  order.updated_at = intent.updated_at;
  const payment = {
    payment_id: 'pay_' + event_id.slice(0, 16),
    intent_id,
    order_id: intent.order_id,
    status: next,
    amount_minor: intent.amount_minor,
    currency: intent.currency,
    psp_reference: intent.psp_reference,
    at: intent.updated_at,
  };
  const ev = { event_id, type: 'PAYMENT_' + next, intent_id, status: next, at: intent.updated_at };
  await catalog.writeFace(apiId, 'pay webhook ' + event_id, [
    { path: `payments/intents/${intent_id}.json`, content: intent },
    { path: `payments/orders/${intent.order_id}.json`, content: order },
    { path: `payments/payments/${payment.payment_id}.json`, content: payment },
    { path: `payments/events/${event_id}.json`, content: ev },
  ]);
  return { duplicate: false, intent, payment };
}

async function refund(apiId, { intent_id, amount_minor, idempotencyKey }) {
  if (!idempotencyKey) err(422, 'IDEMPOTENCY_REQUIRED', 'Idempotency-Key required');
  const intent = await catalog.readFace(apiId, `payments/intents/${intent_id}.json`);
  if (!intent) err(404, 'NOT_FOUND', 'Intent not found');
  if (intent.status !== 'PAID' && intent.status !== 'PARTIALLY_REFUNDED') {
    err(409, 'ILLEGAL_STATE', 'Refund only from PAID');
  }
  const keyHash = hashKey(idempotencyKey);
  const idempPath = `payments/idempotency/rf_${keyHash.slice(0, 32)}.json`;
  const existing = await catalog.readFace(apiId, idempPath);
  if (existing) return { idempotent: true, refund_id: existing.refund_id };
  const prev = intent.refunded_minor || 0;
  const remaining = intent.amount_minor - prev;
  const want = Number(amount_minor);
  if (!Number.isFinite(want) || want < 1 || want > remaining) err(409, 'REFUND_EXCEEDS_REMAINING', 'Refund exceeds remaining');
  const refund_id = 'rf_' + objectId();
  intent.refunded_minor = prev + want;
  const next = intent.refunded_minor >= intent.amount_minor ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
  assertTransition(intent.status, next);
  intent.status = next;
  intent._version = (intent._version || 1) + 1;
  intent.updated_at = catalog.nowIso();
  const rec = { refund_id, intent_id, amount_minor: want, status: next, at: intent.updated_at };
  await catalog.writeFace(apiId, 'pay refund ' + refund_id, [
    { path: `payments/intents/${intent_id}.json`, content: intent },
    { path: `payments/refunds/${refund_id}.json`, content: rec },
    { path: `payments/events/${refund_id}.json`, content: { type: 'PAYMENT_REFUNDED', refund_id, intent_id, at: rec.at } },
    { path: idempPath, content: { refund_id, key_hash: keyHash, created_at: rec.at } },
  ]);
  return { idempotent: false, refund: rec, intent };
}

async function getIntent(apiId, intent_id) {
  const intent = await catalog.readFace(apiId, `payments/intents/${intent_id}.json`);
  if (!intent) err(404, 'NOT_FOUND', 'Intent not found');
  return intent;
}

async function paymentHealth(apiId) {
  const psp = await loadPsp(apiId);
  return {
    psp_configured: Boolean(psp),
    webhook_secret: psp ? 'configured' : 'NOT_CONFIGURED',
    checkout_base: psp && psp.checkout_base ? 'configured' : 'NOT_CONFIGURED',
    signature_verifier: 'ready',
    currency: 'PKR',
    amount_validation: 'server-owned items[]',
    idempotency: 'required',
    event_dedup: 'pay_events',
    refund_protection: 'remaining check',
    ledger: 'Repo 10 payments/*',
  };
}

module.exports = {
  setPsp, loadPsp, putProduct, createIntent, handleWebhook, refund, getIntent, paymentHealth,
};
