try { require('dotenv').config(); } catch (e) { /* optional */ }
const express = require('express');
const cors = require('cors');
const path = require('path');
const config = require('./config');
const { bootstrap } = require('./db/bootstrap');
const publicApi = require('./api/public');
const adminApi = require('./api/admin');

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/health', (req, res) => {
  res.json({ status: 'ok', engine: 'github-store', database: config.databaseRepo });
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
