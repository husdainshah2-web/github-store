const crypto = require('crypto');
const config = require('../config');

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function hashKey(raw) {
  return sha256(Buffer.from(String(raw)));
}

function secretKey() {
  return crypto.createHash('sha256').update(String(config.jwtSecret || 'gitdb-key-wrap')).digest();
}

function encryptSecret(text) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', secretKey(), iv);
  const enc = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

function decryptSecret(payload) {
  if (!payload) return null;
  const buf = Buffer.from(String(payload), 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', secretKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

module.exports = { sha256, hashKey, encryptSecret, decryptSecret };
