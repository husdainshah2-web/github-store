const crypto = require('crypto');

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function hashKey(raw) {
  return sha256(Buffer.from(String(raw)));
}

module.exports = { sha256, hashKey };
