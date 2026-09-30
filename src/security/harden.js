const crypto = require('crypto');

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  if (left.length !== right.length) {
    crypto.timingSafeEqual(left.length ? left : Buffer.from('x'), left.length ? left : Buffer.from('x'));
    return false;
  }
  return crypto.timingSafeEqual(left, right);
}

const buckets = new Map();

function touch(key, windowMs, max) {
  const now = Date.now();
  const slot = Math.floor(now / windowMs);
  const id = key + ':' + slot;
  const n = (buckets.get(id) || 0) + 1;
  buckets.set(id, n);
  if (buckets.size > 5000) {
    for (const k of buckets.keys()) {
      if (!k.endsWith(':' + slot) && !k.endsWith(':' + (slot - 1))) buckets.delete(k);
      if (buckets.size < 2000) break;
    }
  }
  return n <= max;
}

function clientIp(req) {
  const raw = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '')
    .split(',')[0]
    .trim();
  return raw.slice(0, 64) || 'unknown';
}

function blockProbes(req, res, next) {
  const p = String(req.path || '').toLowerCase();
  if (
    p.includes('/.env') ||
    p.includes('/.git') ||
    p.includes('wp-admin') ||
    p.includes('phpmyadmin') ||
    p.endsWith('.php')
  ) {
    return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Not found' } });
  }
  next();
}

module.exports = { safeEqual, touch, clientIp, blockProbes };
