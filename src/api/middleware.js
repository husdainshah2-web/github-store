const jwt = require('jsonwebtoken');
const config = require('../config');
const engine = require('../db/engine');
const { fail } = require('../utils/http');

const hits = new Map();

function rateLimit(kind = 'req') {
  return (req, res, next) => {
    const key = (req.api && req.api.api_id) || req.ip || 'anon';
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
    const api = await engine.findApiByKey(token);
    if (!api) return fail(res, 401, 'UNAUTHORIZED', 'Invalid API key');
    req.api = api;
    next();
  } catch (err) {
    return fail(res, 502, 'GITHUB_ERROR', 'Auth lookup failed');
  }
}

function adminAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return fail(res, 401, 'UNAUTHORIZED', 'Missing admin token');
  try {
    const payload = jwt.verify(token, config.jwtSecret);
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
      if (err.status === 409 || err.code === 'REF_CONFLICT') {
        return fail(res, 409, 'CONFLICT', 'Git conflict, retry');
      }
      console.error(err);
      return fail(res, 500, 'INTERNAL', 'Internal error');
    }
  };
}

module.exports = { rateLimit, apiAuth, adminAuth, wrap };
