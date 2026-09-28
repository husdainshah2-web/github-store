const config = require('../config');
const git = require('../github/client');
const { nowIso, apiId, objectId, txId, apiKey, shard } = require('../utils/ids');
const { sha256, hashKey } = require('../utils/hash');
const paths = require('../storage/paths');
const { chooseRepo, repoById } = require('../storage/router');

const DB = () => config.databaseRepo;

const cache = {
  apis: new Map(),
  objects: new Map(),
  indexes: new Map(),
};

function parseJson(file) {
  if (!file) return null;
  return JSON.parse(file.text);
}

async function readJson(path) {
  const f = await git.readFileUtf8(DB(), path);
  return parseJson(f);
}

async function writeDb(message, changes) {
  return git.commitFiles(DB(), message, changes);
}

async function getApi(id) {
  if (cache.apis.has(id)) return cache.apis.get(id);
  const rec = await readJson(paths.apiPath(id));
  if (rec) cache.apis.set(id, rec);
  return rec;
}

async function listApis() {
  const idx = await readJson('indexes/apis.json');
  const ids = (idx && idx.ids) || [];
  const out = [];
  for (const id of ids) {
    const a = await getApi(id);
    if (a) {
      const copy = { ...a };
      delete copy.key_hash;
      out.push(copy);
    }
  }
  return out;
}

async function findApiByKey(rawKey) {
  const hash = hashKey(rawKey);
  const idx = await readJson('indexes/apis.json');
  const ids = (idx && idx.ids) || [];
  for (const id of ids) {
    const a = await getApi(id);
    if (a && a.key_hash === hash && a.status === 'active') return a;
  }
  return null;
}

async function createApi(name) {
  const id = apiId();
  const raw = apiKey();
  const rec = {
    api_id: id,
    name,
    status: 'active',
    key_hash: hashKey(raw),
    created_at: nowIso(),
    updated_at: nowIso(),
    object_count: 0,
  };
  const idx = (await readJson('indexes/apis.json')) || { ids: [] };
  if (!idx.ids.includes(id)) idx.ids.push(id);
  await writeDb(`create api ${id}`, [
    { path: paths.apiPath(id), contentUtf8: JSON.stringify(rec, null, 2) },
    { path: paths.apiIndexPath(id), contentUtf8: JSON.stringify({ ids: [] }, null, 2) },
    { path: 'indexes/apis.json', contentUtf8: JSON.stringify(idx, null, 2) },
  ]);
  cache.apis.set(id, rec);
  return { api: rec, raw_key: raw };
}

async function updateApi(id, patch) {
  const rec = await getApi(id);
  if (!rec) return null;
  Object.assign(rec, patch, { updated_at: nowIso() });
  await writeDb(`update api ${id}`, [
    { path: paths.apiPath(id), contentUtf8: JSON.stringify(rec, null, 2) },
  ]);
  cache.apis.set(id, rec);
  return rec;
}

async function rotateApiKey(id) {
  const raw = apiKey();
  const rec = await updateApi(id, { key_hash: hashKey(raw) });
  return { api: rec, raw_key: raw };
}

async function getObject(objectIdValue) {
  if (cache.objects.has(objectIdValue)) return cache.objects.get(objectIdValue);
  const rec = await readJson(paths.objectMetaPath(objectIdValue));
  if (rec) cache.objects.set(objectIdValue, rec);
  return rec;
}

async function listObjectIdsForApi(apiIdValue) {
  if (cache.indexes.has(apiIdValue)) return cache.indexes.get(apiIdValue);
  const idx = await readJson(paths.apiIndexPath(apiIdValue));
  const ids = (idx && idx.ids) || [];
  cache.indexes.set(apiIdValue, ids);
  return ids;
}

async function setApiIndex(apiIdValue, ids) {
  cache.indexes.set(apiIdValue, ids);
  return { path: paths.apiIndexPath(apiIdValue), contentUtf8: JSON.stringify({ ids }, null, 2) };
}

async function writeTransaction(tx) {
  return writeDb(`tx ${tx.tx_id} ${tx.status}`, [
    { path: paths.txPath(tx.tx_id), contentUtf8: JSON.stringify(tx, null, 2) },
  ]);
}

async function readTransaction(id) {
  return readJson(paths.txPath(id));
}

async function appendAudit(event) {
  const day = event.at.slice(0, 10);
  const path = paths.logPath(day, 'audit');
  const existing = (await readJson(path)) || { events: [] };
  existing.events.push(event);
  if (existing.events.length > 500) existing.events = existing.events.slice(-500);
  await writeDb(`audit ${event.type}`, [
    { path, contentUtf8: JSON.stringify(existing, null, 2) },
  ]);
}

function assertOwner(api, obj) {
  if (!obj) {
    const e = new Error('OBJECT_NOT_FOUND');
    e.code = 'OBJECT_NOT_FOUND';
    e.status = 404;
    throw e;
  }
  if (obj.status === 'deleted') {
    const e = new Error('OBJECT_NOT_FOUND');
    e.code = 'OBJECT_NOT_FOUND';
    e.status = 404;
    throw e;
  }
  if (api.role !== 'admin' && obj.api_id !== api.api_id) {
    const e = new Error('FORBIDDEN');
    e.code = 'FORBIDDEN';
    e.status = 403;
    throw e;
  }
}

async function rebuildIndex() {
  cache.apis.clear();
  cache.objects.clear();
  cache.indexes.clear();
  const idx = (await readJson('indexes/apis.json')) || { ids: [] };
  const byApi = {};
  for (const id of idx.ids) byApi[id] = [];
  // Walk known indexes if present; metadata remains source of truth per-object on get.
  const changes = [
    { path: 'indexes/apis.json', contentUtf8: JSON.stringify(idx, null, 2) },
  ];
  for (const id of idx.ids) {
    const local = (await readJson(paths.apiIndexPath(id))) || { ids: [] };
    byApi[id] = local.ids || [];
    cache.indexes.set(id, byApi[id]);
    changes.push({ path: paths.apiIndexPath(id), contentUtf8: JSON.stringify({ ids: byApi[id] }, null, 2) });
  }
  await writeDb('rebuild-index', changes);
  return { apis: idx.ids.length, indexes: Object.keys(byApi).length };
}

module.exports = {
  cache,
  getApi,
  listApis,
  findApiByKey,
  createApi,
  updateApi,
  rotateApiKey,
  getObject,
  listObjectIdsForApi,
  setApiIndex,
  writeTransaction,
  readTransaction,
  appendAudit,
  assertOwner,
  rebuildIndex,
  writeDb,
  readJson,
  DB,
  objectId,
  txId,
  nowIso,
  sha256,
  chooseRepo,
  repoById,
  paths,
};
