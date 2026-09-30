const jwt = require('jsonwebtoken');
const config = require('../config');
const engine = require('../db/engine');
const { fail } = require('../utils/http');
const { touch, clientIp } = require('../security/harden');

const hits = new Map();

function rateLimit(kind = 'req') {
  return (req, res, next) => {
    const key = (req.api && req.api.api_id) || clientIp(req);
    const ipOk = touch('ip:' + kind + ':' + clientIp(req), 60 * 1000, kind === 'upload' ? 20 : 180);
    if (!ipOk) return fail(res, 429, 'RATE_LIMITED', 'Too many requests');
    const bucket = `${kind}:${key}:${Math.floor(Date.now() / 60000)}`;
    const n = (hits.get(bucket) || 0) + 1;
    hits.set(bucket, n);
    const limit = kind === 'upload' ? config.uploadsPerMinute : config.rateLimitPerMinute;
    if (n > limit) return fail(res, 429, 'RATE_LIMITED', 'Too many requests');
    next();
  };
}

async function apiAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return fail(res, 401, 'UNAUTHORIZED', 'Missing API key');
  try {
    if (token.split('.').length === 3) {
      const payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
      if (payload.role !== 'api-user' || !payload.api_id) {
        return fail(res, 401, 'UNAUTHORIZED', 'Invalid session');
      }
      const api = await engine.getApi(payload.api_id);
      if (!api || api.status !== 'active') return fail(res, 401, 'UNAUTHORIZED', 'Invalid session');
      req.api = api;
      req.principal = payload.username;
      return next();
    }
    if (token.length < 20 || token.length > 200) return fail(res, 401, 'UNAUTHORIZED', 'Invalid API key');
    const api = await engine.findApiByKey(token);
    if (!api) return fail(res, 401, 'UNAUTHORIZED', 'Invalid API key');
    if (api.password_hash) {
      return fail(res, 401, 'LOGIN_REQUIRED', 'This API requires username/password login first');
    }
    req.api = api;
    next();
  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      return fail(res, 401, 'UNAUTHORIZED', 'Invalid session');
    }
    return fail(res, 502, 'GITHUB_ERROR', 'Auth lookup failed');
  }
}

function adminAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return fail(res, 401, 'UNAUTHORIZED', 'Missing admin token');
  try {
    const payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
    if (payload.role !== 'admin') return fail(res, 403, 'FORBIDDEN', 'Admin only');
    req.api = { api_id: 'admin', role: 'admin', name: payload.username };
    next();
  } catch (err) {
    return fail(res, 401, 'UNAUTHORIZED', 'Invalid admin token');
  }
}

function wrap(fn) {
  return async (req, res, next) => {
    try {
      await fn(req, res, next);
    } catch (err) {
      if (err.status) return fail(res, err.status, err.code || 'ERROR', err.message);
      if (err.code === 'REF_CONFLICT') {
        return fail(res, 409, 'CONFLICT', 'Git conflict, retry');
      }
      console.error('internal', err.code || err.name);
      return fail(res, 500, 'INTERNAL', 'Internal error');
    }
  };
}

module.exports = { rateLimit, apiAuth, adminAuth, wrap };
