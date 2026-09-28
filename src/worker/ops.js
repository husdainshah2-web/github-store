const config = require('../config');
const git = require('../github/client');
const engine = require('../db/engine');
const { objectDataPath } = require('../storage/paths');
const { objectId, nowIso, txId } = require('../utils/ids');
const { sha256 } = require('../utils/hash');

function mimeOf(name, fallback) {
  const ext = String(name || '').split('.').pop().toLowerCase();
  const map = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
    gif: 'image/gif', svg: 'image/svg+xml', pdf: 'application/pdf', zip: 'application/zip',
    json: 'application/json', txt: 'text/plain', mp4: 'video/mp4', webm: 'video/webm',
    bin: 'application/octet-stream',
  };
  return fallback || map[ext] || 'application/octet-stream';
}

function storedName(filename) {
  const safe = String(filename || 'file.bin').replace(/[^a-zA-Z0-9._-]/g, '_');
  return safe || 'file.bin';
}

async function insertObject(api, { filename, buffer, mime_type }) {
  if (!buffer || !buffer.length) {
    const e = new Error('Empty body');
    e.status = 422; e.code = 'INVALID_REQUEST';
    throw e;
  }
  if (buffer.length > config.maxFileSize) {
    const e = new Error(`File exceeds MAX_FILE_SIZE (${config.maxFileSize} bytes)`);
    e.status = 413; e.code = 'FILE_TOO_LARGE';
    throw e;
  }
  if (buffer.length > config.hardGithubLimit) {
    const e = new Error('File exceeds GitHub 100 MiB limit');
    e.status = 413; e.code = 'FILE_TOO_LARGE';
    throw e;
  }

  const oid = objectId();
  const route = engine.chooseRepo(oid);
  const name = storedName(filename);
  const dataPath = objectDataPath(api.api_id, oid, name);
  const hash = sha256(buffer);
  const tx = {
    tx_id: txId(),
    type: 'INSERT',
    status: 'processing',
    api_id: api.api_id,
    object_id: oid,
    created_at: nowIso(),
  };

  const meta = {
    object_id: oid,
    api_id: api.api_id,
    repository_id: route.repository_id,
    path: dataPath,
    filename: filename || name,
    stored_name: name,
    mime_type: mimeOf(filename, mime_type),
    size: buffer.length,
    sha256: hash,
    status: 'creating',
    created_at: nowIso(),
    updated_at: nowIso(),
  };

  await git.commitFiles(route.repo, `insert ${oid}`, [
    { path: dataPath, contentBase64: buffer.toString('base64') },
  ]);

  const ids = await engine.listObjectIdsForApi(api.api_id);
  const nextIds = ids.includes(oid) ? ids : ids.concat(oid);
  const indexChange = await engine.setApiIndex(api.api_id, nextIds);
  meta.status = 'active';
  tx.status = 'committed';
  tx.finished_at = nowIso();

  const apiRec = await engine.getApi(api.api_id);
  if (apiRec) {
    apiRec.object_count = nextIds.length;
    apiRec.updated_at = nowIso();
    engine.cache.apis.set(api.api_id, apiRec);
  }

  await engine.writeDb(`insert meta ${oid}`, [
    { path: engine.paths.objectMetaPath(oid), contentUtf8: JSON.stringify(meta, null, 2) },
    indexChange,
    apiRec ? { path: engine.paths.apiPath(api.api_id), contentUtf8: JSON.stringify(apiRec, null, 2) } : null,
    { path: engine.paths.txPath(tx.tx_id), contentUtf8: JSON.stringify(tx, null, 2) },
  ].filter(Boolean));

  engine.cache.objects.set(oid, meta);
  return { object_id: oid, status: 'stored', tx_id: tx.tx_id, meta };
}

async function rewriteObject(api, oid, { filename, buffer, mime_type }) {
  const obj = await engine.getObject(oid);
  engine.assertOwner(api, obj);
  if (!buffer || !buffer.length) {
    const e = new Error('Empty body');
    e.status = 422; e.code = 'INVALID_REQUEST';
    throw e;
  }
  if (buffer.length > config.maxFileSize) {
    const e = new Error('File too large');
    e.status = 413; e.code = 'FILE_TOO_LARGE';
    throw e;
  }
  const route = engine.repoById(obj.repository_id);
  const name = storedName(filename || obj.stored_name || obj.filename);
  const newPath = objectDataPath(obj.api_id, oid, name);
  const changes = [
    { path: newPath, contentBase64: buffer.toString('base64') },
  ];
  if (obj.path && obj.path !== newPath) changes.push({ path: obj.path, delete: true });

  obj.status = 'updating';
  await git.commitFiles(route.repo, `rewrite ${oid}`, changes);

  obj.path = newPath;
  obj.stored_name = name;
  obj.filename = filename || obj.filename;
  obj.mime_type = mimeOf(filename || obj.filename, mime_type || obj.mime_type);
  obj.size = buffer.length;
  obj.sha256 = sha256(buffer);
  obj.status = 'active';
  obj.updated_at = nowIso();
  await engine.writeDb(`rewrite meta ${oid}`, [
    { path: engine.paths.objectMetaPath(oid), contentUtf8: JSON.stringify(obj, null, 2) },
  ]);
  engine.cache.objects.set(oid, obj);
  return obj;
}

async function renameObject(api, oid, newFilename) {
  const obj = await engine.getObject(oid);
  engine.assertOwner(api, obj);
  const name = storedName(newFilename);
  if (!name) {
    const e = new Error('Invalid filename');
    e.status = 422; e.code = 'INVALID_REQUEST';
    throw e;
  }
  const route = engine.repoById(obj.repository_id);
  const file = await git.readFileBinary(route.repo, obj.path);
  if (!file) {
    const e = new Error('Data file missing');
    e.status = 500; e.code = 'INCONSISTENT';
    throw e;
  }
  const newPath = objectDataPath(obj.api_id, oid, name);
  await git.commitFiles(route.repo, `rename ${oid}`, [
    { path: newPath, contentBase64: file.buffer.toString('base64') },
    { path: obj.path, delete: true },
  ]);
  obj.filename = newFilename;
  obj.stored_name = name;
  obj.path = newPath;
  obj.updated_at = nowIso();
  await engine.writeDb(`rename meta ${oid}`, [
    { path: engine.paths.objectMetaPath(oid), contentUtf8: JSON.stringify(obj, null, 2) },
  ]);
  engine.cache.objects.set(oid, obj);
  return obj;
}

async function deleteObject(api, oid) {
  const obj = await engine.getObject(oid);
  engine.assertOwner(api, obj);
  const route = engine.repoById(obj.repository_id);
  try {
    await git.commitFiles(route.repo, `delete ${oid}`, [
      { path: obj.path, delete: true },
    ]);
  } catch (err) {
    if (!String(err.message).includes('404')) {
      // continue to logical delete even if file already gone
    }
  }
  obj.status = 'deleted';
  obj.updated_at = nowIso();
  const ids = (await engine.listObjectIdsForApi(obj.api_id)).filter((x) => x !== oid);
  const indexChange = await engine.setApiIndex(obj.api_id, ids);
  const apiRec = await engine.getApi(obj.api_id);
  if (apiRec) {
    apiRec.object_count = ids.length;
    apiRec.updated_at = nowIso();
    engine.cache.apis.set(obj.api_id, apiRec);
  }
  await engine.writeDb(`delete meta ${oid}`, [
    { path: engine.paths.objectMetaPath(oid), contentUtf8: JSON.stringify(obj, null, 2) },
    indexChange,
    apiRec ? { path: engine.paths.apiPath(obj.api_id), contentUtf8: JSON.stringify(apiRec, null, 2) } : null,
  ].filter(Boolean));
  engine.cache.objects.set(oid, obj);
  return { deleted: true, object_id: oid };
}

async function downloadObject(api, oid) {
  const obj = await engine.getObject(oid);
  engine.assertOwner(api, obj);
  const route = engine.repoById(obj.repository_id);
  const file = await git.readFileBinary(route.repo, obj.path);
  if (!file) {
    const e = new Error('INCONSISTENT');
    e.status = 500; e.code = 'INCONSISTENT';
    throw e;
  }
  return { obj, buffer: file.buffer };
}

async function verifyObject(oid) {
  const obj = await engine.getObject(oid);
  if (!obj) return { object_id: oid, status: 'INCONSISTENT', reason: 'metadata missing' };
  if (obj.status === 'deleted') return { object_id: oid, status: 'deleted' };
  const route = engine.repoById(obj.repository_id);
  if (!route) return { object_id: oid, status: 'INCONSISTENT', reason: 'bad repository_id' };
  const file = await git.readFileBinary(route.repo, obj.path);
  if (!file) return { object_id: oid, status: 'INCONSISTENT', reason: 'data file missing' };
  const hash = sha256(file.buffer);
  if (hash !== obj.sha256) return { object_id: oid, status: 'INCONSISTENT', reason: 'hash mismatch' };
  if (file.buffer.length !== obj.size) return { object_id: oid, status: 'INCONSISTENT', reason: 'size mismatch' };
  return { object_id: oid, status: 'OK' };
}

module.exports = {
  insertObject,
  rewriteObject,
  renameObject,
  deleteObject,
  downloadObject,
  verifyObject,
  mimeOf,
};
