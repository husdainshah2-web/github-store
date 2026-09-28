const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const config = require('../config');
const { ok, fail } = require('../utils/http');
const { adminAuth, wrap } = require('./middleware');
const engine = require('../db/engine');
const ops = require('../worker/ops');
const git = require('../github/client');

const router = express.Router();

router.post('/login', wrap(async (req, res) => {
  const { username, password } = req.body || {};
  if (username !== config.adminUser || password !== config.adminPassword) {
    return fail(res, 401, 'UNAUTHORIZED', 'Invalid admin credentials');
  }
  const token = jwt.sign({ role: 'admin', username }, config.jwtSecret, { expiresIn: '7d' });
  return ok(res, { token, username });
}));

router.use(adminAuth);

router.get('/overview', wrap(async (req, res) => {
  const apis = await engine.listApis();
  let objects = 0;
  for (const a of apis) objects += a.object_count || 0;
  const repos = [];
  for (const name of [config.databaseRepo, ...config.dataRepos]) {
    try {
      const info = await git.getRepo(name);
      const commits = await git.listCommits(name, 1);
      repos.push({
        name,
        private: info.private,
        size_kb: info.size,
        last_commit: commits[0] && commits[0].commit && commits[0].commit.committer && commits[0].commit.committer.date,
        url: info.html_url,
        role: name === config.databaseRepo ? 'database' : 'data',
      });
    } catch (err) {
      repos.push({ name, error: err.message, role: name === config.databaseRepo ? 'database' : 'data' });
    }
  }
  return ok(res, {
    apis: apis.length,
    objects,
    data_repos: config.dataRepos.length,
    database_repo: config.databaseRepo,
    repos,
  });
}));

router.get('/apis', wrap(async (req, res) => ok(res, await engine.listApis())));

router.post('/apis', wrap(async (req, res) => {
  const name = (req.body && req.body.name) || 'Untitled API';
  const created = await engine.createApi(name);
  await engine.appendAudit({ at: engine.nowIso(), type: 'api_created', api_id: created.api.api_id }).catch(() => {});
  return ok(res, {
    api: { ...created.api, key_hash: undefined },
    api_key: created.raw_key,
    warning: 'Save this API key now. It will not be shown again.',
  }, 201);
}));

router.post('/apis/:id/disable', wrap(async (req, res) => {
  const rec = await engine.updateApi(req.params.id, { status: 'disabled' });
  if (!rec) return fail(res, 404, 'NOT_FOUND', 'API not found');
  return ok(res, rec);
}));

router.post('/apis/:id/enable', wrap(async (req, res) => {
  const rec = await engine.updateApi(req.params.id, { status: 'active' });
  if (!rec) return fail(res, 404, 'NOT_FOUND', 'API not found');
  return ok(res, rec);
}));

router.post('/apis/:id/rotate-key', wrap(async (req, res) => {
  const result = await engine.rotateApiKey(req.params.id);
  if (!result.api) return fail(res, 404, 'NOT_FOUND', 'API not found');
  return ok(res, { api_id: result.api.api_id, api_key: result.raw_key });
}));

router.get('/objects', wrap(async (req, res) => {
  const apis = await engine.listApis();
  const q = (req.query.q || '').toLowerCase();
  const items = [];
  for (const a of apis) {
    const ids = await engine.listObjectIdsForApi(a.api_id);
    for (const id of ids) {
      const obj = await engine.getObject(id);
      if (!obj || obj.status === 'deleted') continue;
      if (q && !`${obj.object_id} ${obj.filename} ${obj.sha256} ${obj.mime_type}`.toLowerCase().includes(q)) continue;
      items.push(obj);
    }
  }
  return ok(res, { items, total: items.length });
}));

router.get('/objects/:id', wrap(async (req, res) => {
  const obj = await engine.getObject(req.params.id);
  if (!obj) return fail(res, 404, 'OBJECT_NOT_FOUND', 'Object not found');
  return ok(res, obj);
}));

router.get('/objects/:id/content', wrap(async (req, res) => {
  const { obj, buffer } = await ops.downloadObject(req.api, req.params.id);
  res.set('Content-Type', obj.mime_type);
  return res.send(buffer);
}));

router.delete('/objects/:id', wrap(async (req, res) => {
  const obj = await engine.getObject(req.params.id);
  if (!obj) return fail(res, 404, 'OBJECT_NOT_FOUND', 'Object not found');
  return ok(res, await ops.deleteObject(req.api, req.params.id));
}));

router.post('/rebuild-index', wrap(async (req, res) => ok(res, await engine.rebuildIndex())));

router.get('/objects/:id/verify', wrap(async (req, res) => ok(res, await ops.verifyObject(req.params.id))));

router.get('/health-db', wrap(async (req, res) => {
  const apisIdx = await engine.readJson('indexes/apis.json');
  return ok(res, {
    database_repo: config.databaseRepo,
    apis_index: apisIdx || { ids: [] },
    cache_apis: engine.cache.apis.size,
    cache_objects: engine.cache.objects.size,
  });
}));

module.exports = router;
