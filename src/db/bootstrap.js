const config = require('../config');
const git = require('../github/client');
const engine = require('./engine');

async function bootstrap() {
  const existing = await engine.readJson('indexes/apis.json');
  if (existing && existing.ids) {
    console.log('Database repo already initialized');
    return existing;
  }
  const files = [
    { path: 'system/config.json', contentUtf8: JSON.stringify({
      version: 1,
      data_repos: config.dataRepos,
      created_at: new Date().toISOString(),
    }, null, 2) },
    { path: 'indexes/apis.json', contentUtf8: JSON.stringify({ ids: [] }, null, 2) },
    { path: 'system/README.md', contentUtf8: 'This repository is the DATABASE. Do not store object binaries here.\n' },
  ];
  await git.commitFiles(config.databaseRepo, 'bootstrap database repo', files);
  console.log('Bootstrapped database repository');
  return { ids: [] };
}

module.exports = { bootstrap };
