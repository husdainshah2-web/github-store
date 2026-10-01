const config = require('../config');
const git = require('../github/client');
const { nowIso, apiId, objectId, txId, apiKey, shard } = require('../utils/ids');
const { sha256, hashKey, encryptSecret, decryptSecret } = require('../utils/hash');
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

let apisIndexCache = { at: 0, ids: null };

async function listApis() {
  const now = Date.now();
  let ids;
  if (apisIndexCache.ids && now - apisIndexCache.at < 15000) {
    ids = apisIndexCache.ids;
  } else {
    const idx = await readJson('indexes/apis.json');
    ids = (idx && idx.ids) || [];
    apisIndexCache = { at: now, ids };
  }
  const out = [];
  for (const id of ids) {
    const a = await getApi(id);
    if (a) {
      const copy = { ...a };
      delete copy.key_hash;
      delete copy.key_enc;
      delete copy.password_hash;
      out.push(copy);
    }
  }
  return out;
}

const keyMap = new Map();

async function rebuildKeyMap() {
  keyMap.clear();
  const idx = (await readJson('indexes/apis.json')) || { ids: [] };
  for (const id of idx.ids || []) {
    const a = await getApi(id);
    if (a && a.key_hash && a.status === 'active') keyMap.set(a.key_hash, a);
  }
  return keyMap.size;
}

async function findApiByKey(rawKey) {
  const hash = hashKey(rawKey);
  const hit = keyMap.get(hash);
  if (hit && hit.status === 'active') return hit;
  await rebuildKeyMap();
  const again = keyMap.get(hash);
  return again && again.status === 'active' ? again : null;
}

async function createApi(name, creds = {}) {
  const username = String(creds.username || config.apiOperatorUser || '').trim();
  const password = String(creds.password || config.apiOperatorPassword || '');
  if (!username || username.length < 3) {
    const e = new Error('username required (min 3)');
    e.status = 422; e.code = 'INVALID_REQUEST';
    throw e;
  }
  if (password.length < 8) {
    const e = new Error('password required (min 8)');
    e.status = 422; e.code = 'INVALID_REQUEST';
    throw e;
  }
  const bcrypt = require('bcryptjs');
  const id = apiId();
  const raw = apiKey();
  const rec = {
    api_id: id,
    name,
    status: 'active',
    key_hash: hashKey(raw),
    key_enc: encryptSecret(raw),
    operator_username: username,
    password_hash: bcrypt.hashSync(password, 10),
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
  apisIndexCache = { at: 0, ids: null };
  if (rec.key_hash) keyMap.set(rec.key_hash, rec);
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
  const prev = await getApi(id);
  const raw = apiKey();
  const rec = await updateApi(id, { key_hash: hashKey(raw), key_enc: encryptSecret(raw) });
  if (prev && prev.key_hash) keyMap.delete(prev.key_hash);
  if (rec && rec.key_hash) keyMap.set(rec.key_hash, rec);
  return { api: rec, raw_key: raw };
}

function revealApiKey(rec) {
  if (!rec || !rec.key_enc) return null;
  try { return decryptSecret(rec.key_enc); } catch (e) { return null; }
}

async function deleteApi(id) {
  const rec = await getApi(id);
  if (!rec) return null;
  const idx = (await readJson('indexes/apis.json')) || { ids: [] };
  idx.ids = (idx.ids || []).filter((x) => x !== id);
  rec.status = 'deleted';
  rec.updated_at = nowIso();
  await writeDb(`delete api ${id}`, [
    { path: paths.apiPath(id), contentUtf8: JSON.stringify(rec, null, 2) },
    { path: 'indexes/apis.json', contentUtf8: JSON.stringify(idx, null, 2) },
  ]);
  cache.apis.delete(id);
  apisIndexCache = { at: 0, ids: null };
  if (rec.key_hash) keyMap.delete(rec.key_hash);
  return { deleted: true, api_id: id };
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
    const e = new Error('OBJECT_NOT_FOUND');
    e.code = 'OBJECT_NOT_FOUND';
    e.status = 404;
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

async function applyDefaultOperator() {
  const bcrypt = require('bcryptjs');
  const username = String(config.apiOperatorUser || '').trim();
  const password = String(config.apiOperatorPassword || '');
  if (!username || password.length < 8) return { updated: 0 };
  const hash = bcrypt.hashSync(password, 10);
  const idx = (await readJson('indexes/apis.json')) || { ids: [] };
  let updated = 0;
  for (const id of idx.ids || []) {
    const rec = await getApi(id);
    if (!rec || rec.status === 'deleted') continue;
    rec.operator_username = username;
    rec.password_hash = hash;
    rec.updated_at = nowIso();
    await writeDb(`set operator ${id}`, [
      { path: paths.apiPath(id), contentUtf8: JSON.stringify(rec, null, 2) },
    ]);
    cache.apis.set(id, rec);
    updated += 1;
  }
  return { updated };
}

async function loginApi(name, username, password) {
  const bcrypt = require('bcryptjs');
  const { safeEqual } = require('../security/harden');
  const list = await listApis();
  const wantName = String(name || '').trim().toLowerCase();
  const wantUser = String(username || '').trim();
  const api = list.find((a) => String(a.name || '').trim().toLowerCase() === wantName)
    || list.find((a) => a.api_id === String(name || '').trim());
  const full = api ? await getApi(api.api_id) : null;
  if (!full || full.status !== 'active' || !full.password_hash) {
    const e = new Error('Invalid credentials');
    e.status = 401; e.code = 'UNAUTHORIZED';
    throw e;
  }
  const userOk = safeEqual(String(full.operator_username || ''), wantUser);
  const passOk = bcrypt.compareSync(String(password || ''), full.password_hash);
  if (!userOk || !passOk) {
    const e = new Error('Invalid credentials');
    e.status = 401; e.code = 'UNAUTHORIZED';
    throw e;
  }
  return full;
}

module.exports = {
  cache,
  getApi,
  listApis,
  findApiByKey,
  loginApi,
  applyDefaultOperator,
  rebuildKeyMap,
  createApi,
  updateApi,
  rotateApiKey,
  revealApiKey,
  deleteApi,
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
