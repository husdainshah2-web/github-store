try { require('dotenv').config(); } catch (e) { /* optional */ }
const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');
const { bootstrap } = require('./db/bootstrap');
const engine = require('./db/engine');
const publicApi = require('./api/public');
const adminApi = require('./api/admin');
const { securityHeaders } = require('./security/headers');
const { blockProbes, touch, clientIp } = require('./security/harden');
const limits = require('./monitoring/githubLimits');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(securityHeaders);
app.use(blockProbes);
const allowOrigins = String(process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
app.use(cors({
  origin: allowOrigins.length ? allowOrigins : true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'],
  allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key', 'X-Request-ID', 'X-Session-Token', 'X-GitDB-Signature', 'X-GitDB-Timestamp', 'X-Webhook-Signature', 'X-Webhook-Timestamp'],
  maxAge: 600,
}));

app.post('/v1/pay/webhook/:apiId', express.raw({ type: '*/*', limit: '256kb' }), async (req, res) => {
  try {
    if (!touch('wh:' + clientIp(req), 60 * 1000, 60)) {
      return res.status(429).json({ success: false, error: { code: 'RATE_LIMITED', message: 'Too many webhooks' } });
    }
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(String(req.body || ''), 'utf8');
    if (raw.length > 256 * 1024) {
      return res.status(413).json({ success: false, error: { code: 'PAYLOAD_TOO_LARGE', message: 'Webhook too large' } });
    }
    const pay = require('./db/pay');
    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) headers[String(k).toLowerCase()] = v;
    const out = await pay.handleWebhook(req.params.apiId, raw, headers);
    res.json({ success: true, data: out });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: { code: err.code || 'ERROR', message: err.message } });
  }
});

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: 0, etag: false, lastModified: false }));

const startedAt = Date.now();
let ready = false;

app.get('/version', (req, res) => {
  res.json({ engine: 'GitHubOnlyDB', version: '3.0.0', format_version: 4, brand: 'GitDB' });
});

app.get('/metrics', (req, res) => {
  res.json({
    uptime_s: Math.floor((Date.now() - startedAt) / 1000),
    github_rate: limits.snapshot(),
    ready,
    write_mode: require('./security/mode').state.writeMode,
  });
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    engine: 'GitDB',
    version: '3.0.0', format_version: 4,
    database: config.databaseRepo,
    data_repos: config.dataRepos.length,
    uptime_s: Math.floor((Date.now() - startedAt) / 1000),
    github_rate: limits.snapshot(),
    ready,
  });
});

app.get('/ready', (req, res) => {
  if (!ready) return res.status(503).json({ status: 'not_ready' });
  res.json({ status: 'ready', database: config.databaseRepo });
});

app.post('/webhooks/github', express.raw({ type: 'application/json' }), (req, res) => {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) return res.status(401).json({ ok: false, error: 'WEBHOOK_SECRET_REQUIRED' });
  const sig = req.get('X-Hub-Signature-256') || '';
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(String(req.body || ''), 'utf8');
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex');
  const { safeEqual } = require('./security/harden');
  if (!safeEqual(sig, expected)) return res.status(401).json({ ok: false });
  res.json({ ok: true });
});

app.use('/v1', publicApi);
app.use('/admin/api', adminApi);

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

async function start() {
  if (!config.githubToken) {
    console.error('GITHUB_TOKEN is required');
    process.exit(1);
  }
  if (!process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD.length < 10) {
    console.error('ADMIN_PASSWORD must be set and at least 10 characters');
    process.exit(1);
  }
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 24) {
    console.error('JWT_SECRET must be set and at least 24 characters');
    process.exit(1);
  }
  try {
    await bootstrap();
    await engine.rebuildKeyMap().catch(() => {});
    ready = true;
    require('./worker/recycle').startRecycleWorker();
    require('./monitoring/repoCache').getRepos(true).catch(() => {});
  } catch (err) {
    console.error('Bootstrap failed:', err.message);
  }
  app.listen(config.port, '0.0.0.0', () => {
    console.log(`GitHub Store engine on :${config.port}`);
    console.log(`Database repo: ${config.owner}/${config.databaseRepo}`);
    console.log(`Data repos: ${config.dataRepos.length}`);
  });
}

start();
