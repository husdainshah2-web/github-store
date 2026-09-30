const crypto = require('crypto');

const SENSITIVE_FIELDS = new Set([
  'card', 'card_number', 'cardnumber', 'cardno', 'pan',
  'cvv', 'cvc', 'cid', 'security_code', 'securitycode',
  'expiry', 'expiration', 'exp_month', 'exp_year',
]);

function luhn(num) {
  const s = String(num).replace(/\D/g, '');
  if (s.length < 13 || s.length > 19) return false;
  let sum = 0;
  let alt = false;
  for (let i = s.length - 1; i >= 0; i -= 1) {
    let n = parseInt(s[i], 10);
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

function walk(obj, path, hits) {
  if (!obj || typeof obj !== 'object') return;
  for (const [k, v] of Object.entries(obj)) {
    const key = String(k).toLowerCase().replace(/[^a-z0-9]/g, '');
    const p = path.concat(k);
    if (SENSITIVE_FIELDS.has(key)) {
      hits.push(p.join('.'));
      continue;
    }
    if (typeof v === 'string' && /card|pan|cvv|cvc/.test(key) && /\d{12,}/.test(v)) {
      hits.push(p.join('.'));
      continue;
    }
    if (typeof v === 'string' && luhn(v)) hits.push(p.join('.'));
    if (v && typeof v === 'object') walk(v, p, hits);
  }
}

function scanBody(body) {
  const hits = [];
  if (body && typeof body === 'object') walk(body, [], hits);
  return hits;
}

function requestId(req) {
  const incoming = String(req.get('x-request-id') || '').replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 64);
  return incoming || crypto.randomBytes(8).toString('hex');
}

module.exports = { scanBody, luhn, requestId };
