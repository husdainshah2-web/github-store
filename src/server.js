try { require('dotenv').config(); } catch (e) { /* optional */ }
const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');
const { bootstrap } = require('./db/bootstrap');
const publicApi = require('./api/public');
const adminApi = require('./api/admin');
const { securityHeaders } = require('./security/headers');
const limits = require('./monitoring/githubLimits');

const app = express();
app.disable('x-powered-by');
app.use(securityHeaders);
app.use(cors({ origin: true }));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '..', 'public')));

const startedAt = Date.now();
let ready = false;

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    engine: 'github-store',
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
  if (secret) {
    const sig = req.get('X-Hub-Signature-256') || '';
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body || {}));
    const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex');
    if (sig !== expected) return res.status(401).json({ ok: false });
  }
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
  try {
    await bootstrap();
    ready = true;
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
