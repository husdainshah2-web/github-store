const express = require('express');
const multer = require('multer');
const config = require('../config');
const { ok, fail } = require('../utils/http');
const { apiAuth, rateLimit, wrap } = require('./middleware');
const engine = require('../db/engine');
const ops = require('../worker/ops');
const { queryApi } = require('../db/query');
const mode = require('../security/mode');
const catalog = require('../db/faces');
const authotp = require('../db/authotp');
const notify = require('../db/notify');
const { parseSql } = require('../db/sqlmini');
const enforce = require('../db/enforce');
const pay = require('../db/pay');
const { scanBody, requestId } = require('../security/pan');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxFileSize },
});

const router = express.Router();
router.use((req, res, next) => {
  req.requestId = requestId(req);
  res.setHeader('X-Request-ID', req.requestId);
  next();
});
router.use(apiAuth);
router.use(rateLimit('req'));
router.use((req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const hits = scanBody(req.body);
  if (hits.length) return fail(res, 422, 'PAN_REJECTED', 'Payment card fields are not allowed: ' + hits.join(','));
  next();
});

function fileFromReq(req) {
  if (req.file) {
    return {
      filename: req.file.originalname,
      buffer: req.file.buffer,
      mime_type: req.file.mimetype,
    };
  }
  if (req.body && req.body.content_base64) {
    return {
      filename: req.body.filename || 'file.bin',
      buffer: Buffer.from(req.body.content_base64, 'base64'),
      mime_type: req.body.mime_type,
    };
  }
  if (req.body && typeof req.body.content === 'string') {
    return {
      filename: req.body.filename || 'file.txt',
      buffer: Buffer.from(req.body.content, 'utf8'),
      mime_type: req.body.mime_type || 'text/plain',
    };
  }
  return null;
}

router.use((req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  return mode.guardWrite(req, res, next);
});

router.post('/objects', rateLimit('upload'), upload.single('file'), wrap(async (req, res) => {
  const file = fileFromReq(req);
  if (!file) return fail(res, 422, 'INVALID_REQUEST', 'file or content required');
  file.idempotencyKey = req.get('Idempotency-Key');
  file.collection = (req.body && req.body.collection) || req.query.collection;
  file.tags = req.body && req.body.tags ? [].concat(req.body.tags) : [];
  const result = await ops.insertObject(req.api, file);
  await engine.appendAudit({
    at: engine.nowIso(), type: 'object_inserted', api_id: req.api.api_id, object_id: result.object_id,
  }).catch(() => {});
  return ok(res, { object_id: result.object_id, status: result.status, tx_id: result.tx_id }, 201);
}));

router.get('/objects/count', wrap(async (req, res) => {
  const result = await queryApi(req.api.api_id, { collection: req.query.collection, limit: 10000 });
  return ok(res, { count: result.items.length });
}));

router.get('/objects', wrap(async (req, res) => {
  const ids = await engine.listObjectIdsForApi(req.api.api_id);
  const page = Math.max(1, parseInt(req.query.page || '1', 10));
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '20', 10)));
  const slice = ids.slice((page - 1) * limit, page * limit);
  const items = [];
  for (const id of slice) {
    const obj = await engine.getObject(id);
    if (!obj || obj.status === 'deleted') continue;
    if (req.query.filename && !String(obj.filename).includes(req.query.filename)) continue;
    if (req.query.mime_type && obj.mime_type !== req.query.mime_type) continue;
    if (req.query.status && obj.status !== req.query.status) continue;
    items.push(obj);
  }
  return ok(res, { items, page, limit, total: ids.length });
}));

router.head('/objects/:id', wrap(async (req, res) => {
  const obj = await engine.getObject(req.params.id);
  try {
    engine.assertOwner(req.api, obj);
  } catch (err) {
    return res.status(err.status || 404).end();
  }
  res.set('X-Object-Id', obj.object_id);
  res.set('X-Sha256', obj.sha256);
  res.set('Content-Length', String(obj.size));
  return res.status(200).end();
}));

router.get('/objects/:id', wrap(async (req, res) => {
  const obj = await engine.getObject(req.params.id);
  engine.assertOwner(req.api, obj);
  if (req.query.download === '1') {
    const { buffer } = await ops.downloadObject(req.api, obj.object_id);
    res.set('Content-Type', obj.mime_type);
    res.set('Content-Disposition', `attachment; filename="${obj.filename}"`);
    return res.send(buffer);
  }
  return ok(res, obj);
}));

router.get('/objects/:id/content', wrap(async (req, res) => {
  const { obj, buffer } = await ops.downloadObject(req.api, req.params.id);
  res.set('Content-Type', obj.mime_type);
  res.set('Content-Disposition', `inline; filename="${obj.filename}"`);
  return res.send(buffer);
}));

router.patch('/objects/:id', wrap(async (req, res) => {
  const updated = await ops.patchMetadata(req.api, req.params.id, req.body || {});
  return ok(res, updated);
}));

router.post('/objects/:id/restore', wrap(async (req, res) => {
  return ok(res, await ops.restoreObject(req.api, req.params.id));
}));

router.post('/query', wrap(async (req, res) => {
  const q = req.body || {};
  const result = await queryApi(req.api.api_id, q);
  return ok(res, result);
}));

router.post('/query/count', wrap(async (req, res) => {
  const q = { ...(req.body || {}), limit: 10000 };
  const result = await queryApi(req.api.api_id, q);
  return ok(res, { count: result.items.length, scanned: result.scanned });
}));

router.put('/objects/:id', rateLimit('upload'), upload.single('file'), wrap(async (req, res) => {
  const file = fileFromReq(req);
  if (!file) return fail(res, 422, 'INVALID_REQUEST', 'file or content required');
  const updated = await ops.rewriteObject(req.api, req.params.id, file);
  return ok(res, updated);
}));

router.post('/objects/:id/rename', wrap(async (req, res) => {
  const name = req.body && req.body.filename;
  if (!name) return fail(res, 422, 'INVALID_REQUEST', 'filename required');
  const updated = await ops.renameObject(req.api, req.params.id, name);
  return ok(res, updated);
}));

router.delete('/objects/:id', wrap(async (req, res) => {
  const result = await ops.deleteObject(req.api, req.params.id);
  return ok(res, result);
}));

router.get('/objects/:id/verify', wrap(async (req, res) => {
  const obj = await engine.getObject(req.params.id);
  engine.assertOwner(req.api, obj);
  return ok(res, await ops.verifyObject(req.params.id));
}));

// Firebase-like collection/document API. Same GitHub storage. 15-day TTL.
router.post('/data/:collection', rateLimit('upload'), wrap(async (req, res) => {
  await enforce.assertCanWrite(req.api, req);
  const collection = catalog.sanitizeCollection(req.params.collection);
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const pending = await enforce.enforceDocument(req.api.api_id, collection, body, body.id || null);
  const file = {
    filename: (body.id || body.doc_id || 'doc') + '.json',
    buffer: Buffer.from(JSON.stringify(body), 'utf8'),
    mime_type: 'application/json',
    collection,
    custom_metadata: { firebase: true, doc_id: body.id || body.doc_id || null },
  };
  const result = await ops.insertObject(req.api, file);
  await enforce.commitUniques(req.api.api_id, pending.uniqueWrites, result.object_id);
  return ok(res, { id: result.object_id, collection, status: result.status, tx_id: result.tx_id }, 201);
}));

router.get('/data/:collection', wrap(async (req, res) => {
  const result = await queryApi(req.api.api_id, { collection: req.params.collection, limit: parseInt(req.query.limit || '50', 10) });
  return ok(res, { collection: req.params.collection, items: result.items || result });
}));

router.get('/data/:collection/:id', wrap(async (req, res) => {
  const obj = await engine.getObject(req.params.id);
  if (!obj || obj.api_id !== req.api.api_id) return fail(res, 404, 'NOT_FOUND', 'Document not found');
  if (obj.collection && obj.collection !== req.params.collection) return fail(res, 404, 'NOT_FOUND', 'Document not found');
  return ok(res, obj);
}));

router.delete('/data/:collection/:id', wrap(async (req, res) => {
  return ok(res, await ops.deleteObject(req.api, req.params.id));
}));

router.put('/schema/:collection', wrap(async (req, res) => {
  const collection = catalog.sanitizeCollection(req.params.collection);
  const fields = (req.body && req.body.fields) || {};
  const schema = { collection, fields, updated_at: catalog.nowIso() };
  await catalog.writeFace(req.api.api_id, 'schema ' + collection, [
    { path: `schema/${collection}.json`, content: schema },
  ]);
  return ok(res, schema);
}));

router.get('/schema/:collection', wrap(async (req, res) => {
  const collection = catalog.sanitizeCollection(req.params.collection);
  const schema = await catalog.readFace(req.api.api_id, `schema/${collection}.json`);
  if (!schema) return fail(res, 404, 'NOT_FOUND', 'No schema');
  return ok(res, schema);
}));

router.put('/kv/:key', wrap(async (req, res) => {
  const key = catalog.sanitizeKey(req.params.key);
  if (!key) return fail(res, 422, 'INVALID_REQUEST', 'key required');
  const rec = {
    key,
    value: req.body && Object.prototype.hasOwnProperty.call(req.body, 'value') ? req.body.value : req.body,
    updated_at: catalog.nowIso(),
    expires_at: new Date(Date.now() + 15 * 24 * 3600 * 1000).toISOString(),
  };
  await catalog.writeFace(req.api.api_id, 'kv set ' + key, [{ path: `kv/${key}.json`, content: rec }]);
  return ok(res, rec);
}));

router.get('/kv/:key', wrap(async (req, res) => {
  const key = catalog.sanitizeKey(req.params.key);
  const rec = await catalog.readFace(req.api.api_id, `kv/${key}.json`);
  if (!rec) return fail(res, 404, 'NOT_FOUND', 'Key not found');
  if (rec.expires_at && new Date(rec.expires_at).getTime() < Date.now()) return fail(res, 404, 'EXPIRED', 'Key expired');
  return ok(res, rec);
}));

router.post('/kv/:key/incr', wrap(async (req, res) => {
  const key = catalog.sanitizeKey(req.params.key);
  const rec = (await catalog.readFace(req.api.api_id, `kv/${key}.json`)) || {
    key, value: 0, updated_at: catalog.nowIso(),
    expires_at: new Date(Date.now() + 15 * 24 * 3600 * 1000).toISOString(),
  };
  const n = Number(rec.value) || 0;
  rec.value = n + (Number(req.body && req.body.by) || 1);
  rec.updated_at = catalog.nowIso();
  await catalog.writeFace(req.api.api_id, 'kv incr ' + key, [{ path: `kv/${key}.json`, content: rec }]);
  return ok(res, rec);
}));

router.post('/auth/smtp', wrap(async (req, res) => {
  return ok(res, await authotp.setSmtp(req.api.api_id, req.body || {}));
}));

router.post('/auth/otp/start', wrap(async (req, res) => {
  return ok(res, await authotp.startOtp(req.api.api_id, req.body && req.body.email));
}));

router.post('/auth/otp/verify', wrap(async (req, res) => {
  return ok(res, await authotp.verifyOtp(req.api.api_id, req.body && req.body.email, req.body && req.body.code));
}));

router.post('/notify', wrap(async (req, res) => {
  return ok(res, await notify.sendNotify(req.api.api_id, req.body || {}), 201);
}));

router.get('/notify', wrap(async (req, res) => {
  return ok(res, { items: await notify.listNotify(req.api.api_id, req.query.topic) });
}));

router.post('/notify/:id/read', wrap(async (req, res) => {
  return ok(res, await notify.markRead(req.api.api_id, req.params.id));
}));

router.post('/sql', wrap(async (req, res) => {
  const parsed = parseSql((req.body && (req.body.q || req.body.sql)) || '');
  const result = await queryApi(req.api.api_id, parsed);
  return ok(res, { dialect: 'sql-lite', backend: 'GitDB', ...parsed, items: result.items, scanned: result.scanned });
}));

router.post('/query', wrap(async (req, res) => {
  const collection = catalog.sanitizeCollection((req.body && req.body.collection) || req.query.collection);
  const where = Array.isArray(req.body && req.body.where) ? req.body.where : [];
  const limit = Math.min(100, parseInt((req.body && req.body.limit) || 50, 10));
  const result = await queryApi(req.api.api_id, { collection, where, limit });
  return ok(res, { dialect: 'doc', backend: 'GitDB', collection, items: result.items, scanned: result.scanned });
}));

router.put('/rules', wrap(async (req, res) => {
  const rec = {
    read: req.body && req.body.read === 'session' ? 'session' : 'api-key',
    write: req.body && req.body.write === 'session' ? 'session' : 'api-key',
    updated_at: catalog.nowIso(),
  };
  await catalog.writeFace(req.api.api_id, 'rules', [{ path: 'rules.json', content: rec }]);
  return ok(res, rec);
}));

router.get('/rules', wrap(async (req, res) => {
  return ok(res, await enforce.loadRules(req.api.api_id));
}));

router.post('/batch', wrap(async (req, res) => {
  await enforce.assertCanWrite(req.api, req);
  const opsIn = Array.isArray(req.body && req.body.ops) ? req.body.ops.slice(0, 20) : [];
  if (!opsIn.length) return fail(res, 422, 'INVALID_REQUEST', 'ops array required');
  const results = [];
  for (const item of opsIn) {
    const collection = catalog.sanitizeCollection(item.collection);
    const doc = item.doc && typeof item.doc === 'object' ? item.doc : {};
    const pending = await enforce.enforceDocument(req.api.api_id, collection, doc, doc.id || null);
    const file = {
      filename: (doc.id || 'doc') + '.json',
      buffer: Buffer.from(JSON.stringify(doc), 'utf8'),
      mime_type: 'application/json',
      collection,
      custom_metadata: { doc_id: doc.id || null },
    };
    const result = await ops.insertObject(req.api, file);
    await enforce.commitUniques(req.api.api_id, pending.uniqueWrites, result.object_id);
    results.push({ id: result.object_id, collection, tx_id: result.tx_id, status: result.status });
  }
  return ok(res, { backend: 'GitDB', count: results.length, items: results }, 201);
}));

router.get('/count/:collection', wrap(async (req, res) => {
  const collection = catalog.sanitizeCollection(req.params.collection);
  const result = await queryApi(req.api.api_id, { collection, limit: 10000, scanLimit: 10000 });
  return ok(res, {
    collection,
    count: result.items.length,
    scanned: result.scanned,
    truncated: result.next_cursor != null,
    backend: 'GitDB',
  });
}));

router.post('/explain', wrap(async (req, res) => {
  const parsed = req.body && req.body.q
    ? parseSql(req.body.q)
    : {
      collection: catalog.sanitizeCollection(req.body && req.body.collection),
      where: Array.isArray(req.body && req.body.where) ? req.body.where : [],
      limit: 20,
    };
  const result = await queryApi(req.api.api_id, { ...parsed, limit: parsed.limit || 20 });
  return ok(res, {
    backend: 'GitDB',
    plan: 'full-scan-with-filters',
    collection: parsed.collection,
    where: parsed.where || [],
    scanned: result.scanned,
    matched: result.items.length,
    note: 'No external search engine. Count is from GitHub object index scan.',
  });
}));

router.post('/push/subscribe', wrap(async (req, res) => {
  const sub = req.body && req.body.subscription;
  if (!sub || !sub.endpoint) return fail(res, 422, 'INVALID_REQUEST', 'subscription.endpoint required');
  const rec = { endpoint: String(sub.endpoint).slice(0, 500), created_at: catalog.nowIso() };
  const key = catalog.sanitizeKey(Buffer.from(rec.endpoint).toString('hex').slice(0, 32) || 'sub');
  await catalog.writeFace(req.api.api_id, 'push sub', [{ path: `push/${key}.json`, content: rec }]);
  return ok(res, { stored: true, send: false, reason: 'WEB_PUSH_KEYS_NOT_CONFIGURED' }, 201);
}));

router.post('/push/send', wrap(async (_req, res) => {
  return fail(res, 501, 'WEB_PUSH_KEYS_NOT_CONFIGURED', 'Device push is not configured. Inbox /v1/notify is the real channel.');
}));


router.put('/pay/psp', wrap(async (req, res) => ok(res, await pay.setPsp(req.api.api_id, req.body || {}))));
router.put('/pay/products/:id', wrap(async (req, res) => ok(res, await pay.putProduct(req.api.api_id, req.params.id, req.body || {}))));
router.post('/pay/intent', wrap(async (req, res) => {
  const out = await pay.createIntent(req.api.api_id, {
    items: req.body && req.body.items,
    order_id: req.body && req.body.order_id,
    idempotencyKey: req.get('Idempotency-Key') || (req.body && req.body.idempotency_key),
  });
  return ok(res, out, out.idempotent ? 200 : 201);
}));
router.get('/pay/intent/:id', wrap(async (req, res) => ok(res, await pay.getIntent(req.api.api_id, req.params.id))));
router.post('/pay/refund', wrap(async (req, res) => {
  return ok(res, await pay.refund(req.api.api_id, {
    intent_id: req.body && req.body.intent_id,
    amount_minor: req.body && req.body.amount_minor,
    idempotencyKey: req.get('Idempotency-Key') || (req.body && req.body.idempotency_key),
  }));
}));
router.get('/pay/health', wrap(async (req, res) => ok(res, await pay.paymentHealth(req.api.api_id))));

module.exports = router;
