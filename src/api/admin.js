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
  const repoCache = require('../monitoring/repoCache');
  const apis = await engine.listApis();
  let objects = 0;
  for (const a of apis) objects += a.object_count || 0;
  const force = req.query.refresh === '1';
  const repos = await repoCache.getRepos(force);
  return ok(res, {
    apis: apis.length,
    objects,
    data_repos: config.dataRepos.length,
    database_repo: `${config.owner}/${config.databaseRepo}`,
    repos,
    checked_at: repoCache.cache.at ? new Date(repoCache.cache.at).toISOString() : null,
    cached: !force && Date.now() - repoCache.cache.at < repoCache.cache.ttlMs,
  });
}));

router.get('/apis', wrap(async (req, res) => ok(res, await engine.listApis())));

router.get('/apis/:id', wrap(async (req, res) => {
  const rec = await engine.getApi(req.params.id);
  if (!rec || rec.status === 'deleted') return fail(res, 404, 'NOT_FOUND', 'API not found');
  const api_key = engine.revealApiKey(rec);
  const safe = { ...rec };
  delete safe.key_hash;
  delete safe.key_enc;
  return ok(res, { ...safe, api_key });
}));

router.delete('/apis/:id', wrap(async (req, res) => {
  const result = await engine.deleteApi(req.params.id);
  if (!result) return fail(res, 404, 'NOT_FOUND', 'API not found');
  await engine.appendAudit({ at: engine.nowIso(), type: 'api_deleted', api_id: req.params.id }).catch(() => {});
  return ok(res, result);
}));

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

router.post('/backup', (req, res) => fail(res, 410, 'BACKUP_DISABLED', 'Backup is disabled. Objects live 15 days then purge.'));

router.post('/recycle/sweep', wrap(async (req, res) => {
  const { sweepTrash } = require('../worker/recycle');
  return ok(res, await sweepTrash());
}));

router.get('/policy', wrap(async (req, res) => ok(res, {
  version: '2.2.4.5',
  database_repo: `${config.owner}/${config.databaseRepo}`,
  data_repos: config.dataRepos.length,
  recycle_days: config.recycleDays,
  max_file_size: config.maxFileSize,
  backup_path: null,
  backup_policy: 'disabled',
  ttl_days: config.recycleDays,
})));

router.get('/objects/:id/verify', wrap(async (req, res) => ok(res, await ops.verifyObject(req.params.id))));

router.get('/health-db', wrap(async (req, res) => {
  const apisIdx = await engine.readJson('indexes/apis.json');
  return ok(res, {
    database_repo: config.databaseRepo,
    apis_index: apisIdx || { ids: [] },
    cache_apis: engine.cache.apis.size,
    cache_objects: engine.cache.objects.size,
    write_mode: require('../security/mode').state.writeMode,
  });
}));

router.post('/mode', wrap(async (req, res) => {
  const mode = require('../security/mode');
  const next = mode.setMode((req.body && req.body.mode) || 'NORMAL');
  return ok(res, { write_mode: next });
}));

router.post('/snapshots', (req, res) => fail(res, 410, 'HISTORY_DISABLED', 'No snapshot history. Data expires in 15 days.'));

router.get('/doctor', wrap(async (req, res) => {
  const repoCache = require('../monitoring/repoCache');
  const force = req.query.refresh === '1';
  const repos = await repoCache.getRepos(force);
  const checks = [];
  const push = (name, result, detail) => checks.push({ name, result, detail });
  push('github_token', config.githubToken ? 'PASS' : 'FAIL', config.githubToken ? 'configured' : 'missing');
  const dbName = `${config.owner}/${config.databaseRepo}`;
  const db = repos.find((r) => r.role === 'database' || r.name === dbName || r.name === config.databaseRepo);
  push('database_repo', db && !db.error ? 'PASS' : 'FAIL', db && db.error ? db.error : dbName);
  const data = repos.filter((r) => r.role === 'data');
  const dataOk = data.filter((r) => !r.error).length;
  push('data_repos', dataOk === config.dataRepos.length ? 'PASS' : 'FAIL', `${dataOk}/${config.dataRepos.length} reachable`);
  const idx = await engine.readJson('indexes/apis.json');
  push('apis_index', idx ? 'PASS' : 'FAIL', idx ? `${(idx.ids || []).length} apis` : 'missing');
  const failed = repos.filter((r) => r.error).map((r) => r.name);
  if (failed.length) push('unreachable_repos', 'FAIL', failed.join(', '));
  else push('unreachable_repos', 'PASS', 'none');
  return ok(res, {
    engine: 'GitHubOnlyDB',
    version: '2.2.4.5',
    format_version: 1,
    checked_at: repoCache.cache.at ? new Date(repoCache.cache.at).toISOString() : new Date().toISOString(),
    cached: !force,
    checks,
    repos,
  });
}));

router.post('/objects/:id/restore', wrap(async (req, res) => {
  return ok(res, await ops.restoreObject(req.api, req.params.id));
}));

router.post('/objects/:id/purge', wrap(async (req, res) => {
  return ok(res, await ops.purgeObject(req.api, req.params.id));
}));

module.exports = router;
