const engine = require('./engine');
const { sha256 } = require('../utils/hash');
const { nowIso } = require('../utils/ids');

const TYPES = new Set(['string', 'number', 'boolean', 'json']);

function facePath(apiId, rest) {
  return `faces/${apiId}/${rest}`;
}

async function readFace(apiId, rest) {
  return engine.readJson(facePath(apiId, rest));
}

async function writeFace(apiId, message, files) {
  const changes = files.map((f) => ({
    path: facePath(apiId, f.path),
    contentUtf8: typeof f.content === 'string' ? f.content : JSON.stringify(f.content, null, 2),
  }));
  return engine.writeDb(message, changes);
}

function validateRow(schema, row) {
  const errors = [];
  if (!schema || !schema.fields) return errors;
  for (const [name, rule] of Object.entries(schema.fields)) {
    const val = row[name];
    if (rule.required && (val === undefined || val === null || val === '')) {
      errors.push(`${name} is required`);
      continue;
    }
    if (val === undefined || val === null) continue;
    if (rule.type === 'string' && typeof val !== 'string') errors.push(`${name} must be string`);
    if (rule.type === 'number' && typeof val !== 'number') errors.push(`${name} must be number`);
    if (rule.type === 'boolean' && typeof val !== 'boolean') errors.push(`${name} must be boolean`);
    if (rule.unique) {/* checked by caller against index */}
  }
  return errors;
}

function sanitizeCollection(name) {
  return String(name || 'default').replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 64) || 'default';
}

function sanitizeKey(name) {
  return String(name || '').replace(/[^a-zA-Z0-9._:-]/g, '').slice(0, 80);
}

function emailHash(email) {
  return sha256(Buffer.from(String(email || '').trim().toLowerCase()));
}

module.exports = {
  TYPES,
  facePath,
  readFace,
  writeFace,
  validateRow,
  sanitizeCollection,
  sanitizeKey,
  emailHash,
  nowIso,
};
