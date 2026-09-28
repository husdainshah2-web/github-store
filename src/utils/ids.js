const crypto = require('crypto');

function objectId() {
  return 'obj_' + crypto.randomBytes(8).toString('hex');
}

function apiId() {
  return 'api_' + crypto.randomBytes(3).toString('hex');
}

function txId() {
  return 'tx_' + crypto.randomBytes(8).toString('hex');
}

function apiKey() {
  const groups = [];
  for (let i = 0; i < 10; i += 1) groups.push(String(crypto.randomInt(100, 1000)));
  groups.push(String(crypto.randomInt(10, 100)));
  return 'dtbsprsl-' + groups.join('-');
}

function sanitizeCollection(name) {
  const s = String(name || 'default').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 48);
  return s || 'default';
}

function nowIso() {
  return new Date().toISOString();
}

function shard(id) {
  const hex = (id.replace(/^obj_/, '').replace(/^api_/, '') + '0000').slice(0, 4);
  return { a: hex.slice(0, 2), b: hex.slice(2, 4) };
}

module.exports = { objectId, apiId, txId, apiKey, nowIso, shard, sanitizeCollection };
