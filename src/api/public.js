const express = require('express');
const multer = require('multer');
const config = require('../config');
const { ok, fail } = require('../utils/http');
const { apiAuth, rateLimit, wrap } = require('./middleware');
const engine = require('../db/engine');
const ops = require('../worker/ops');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxFileSize },
});

const router = express.Router();
router.use(apiAuth);
router.use(rateLimit('req'));

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

router.post('/objects', rateLimit('upload'), upload.single('file'), wrap(async (req, res) => {
  const file = fileFromReq(req);
  if (!file) return fail(res, 422, 'INVALID_REQUEST', 'file or content required');
  const result = await ops.insertObject(req.api, file);
  await engine.appendAudit({
    at: engine.nowIso(), type: 'object_inserted', api_id: req.api.api_id, object_id: result.object_id,
  }).catch(() => {});
  return ok(res, { object_id: result.object_id, status: result.status, tx_id: result.tx_id }, 201);
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
  const obj = await engine.getObject(req.params.id);
  engine.assertOwner(req.api, obj);
  if (req.body && req.body.filename) {
    const updated = await ops.renameObject(req.api, req.params.id, req.body.filename);
    return ok(res, updated);
  }
  return fail(res, 422, 'INVALID_REQUEST', 'Nothing to update');
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

module.exports = router;
