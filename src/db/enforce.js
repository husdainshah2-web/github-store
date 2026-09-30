const catalog = require('./faces');

function indexKey(value) {
  return String(value).slice(0, 120);
}

async function loadSchema(apiId, collection) {
  return catalog.readFace(apiId, `schema/${collection}.json`);
}

async function loadRules(apiId) {
  return (await catalog.readFace(apiId, 'rules.json')) || { read: 'api-key', write: 'api-key' };
}

async function assertCanWrite(api, req) {
  const rules = await loadRules(api.api_id);
  if ((rules.write || 'api-key') === 'session') {
    const token = String((req.body && req.body.session) || req.get('x-session-token') || '');
    if (!token) {
      const e = new Error('Session required by rules');
      e.status = 401; e.code = 'SESSION_REQUIRED';
      throw e;
    }
    const { sha256 } = require('../utils/hash');
    const hash = sha256(Buffer.from(token));
    const rec = await catalog.readFace(api.api_id, `auth/sessions/${hash.slice(0, 24)}.json`);
    if (!rec || rec.token_hash !== hash) {
      const e = new Error('Invalid session');
      e.status = 401; e.code = 'SESSION_INVALID';
      throw e;
    }
    if (rec.expires_at && new Date(rec.expires_at).getTime() < Date.now()) {
      const e = new Error('Session expired');
      e.status = 401; e.code = 'SESSION_EXPIRED';
      throw e;
    }
    return rec;
  }
  return null;
}

async function enforceDocument(apiId, collection, row, oid) {
  const schema = await loadSchema(apiId, collection);
  if (!schema || !schema.fields) return { schema: null, uniqueWrites: [] };
  const errors = catalog.validateRow(schema, row);
  if (errors.length) {
    const e = new Error(errors.join('; '));
    e.status = 422; e.code = 'SCHEMA_VIOLATION';
    throw e;
  }
  const uniqueWrites = [];
  for (const [name, rule] of Object.entries(schema.fields)) {
    if (!rule.unique) continue;
    const val = row[name];
    if (val === undefined || val === null || val === '') continue;
    const path = `indexes/${collection}/${name}.json`;
    const idx = (await catalog.readFace(apiId, path)) || { map: {} };
    const k = indexKey(val);
    if (idx.map[k] && idx.map[k] !== oid) {
      const e = new Error(`${name} must be unique`);
      e.status = 409; e.code = 'UNIQUE_VIOLATION';
      throw e;
    }
    idx.map[k] = oid || 'pending';
    uniqueWrites.push({ path, content: idx });
  }
  return { schema, uniqueWrites };
}

async function commitUniques(apiId, uniqueWrites, oid) {
  if (!uniqueWrites.length) return;
  for (const w of uniqueWrites) {
    if (w.content && w.content.map) {
      for (const k of Object.keys(w.content.map)) {
        if (w.content.map[k] === 'pending') w.content.map[k] = oid;
      }
    }
  }
  await catalog.writeFace(apiId, 'unique indexes', uniqueWrites);
}

module.exports = { loadSchema, loadRules, assertCanWrite, enforceDocument, commitUniques };
