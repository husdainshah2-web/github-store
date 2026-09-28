const zlib = require('zlib');
const config = require('../config');
const engine = require('../db/engine');

const BACKUP_PATH = config.backupPath || 'backups/latest.zip';

async function createLatestBackup() {
  const apis = await engine.listApis();
  const objects = [];
  for (const a of apis) {
    const ids = await engine.listObjectIdsForApi(a.api_id);
    for (const id of ids) {
      const obj = await engine.getObject(id);
      if (obj) objects.push(obj);
    }
  }
  const bundle = {
    kind: 'gitdb-backup',
    version: '2.2.4.5',
    created_at: new Date().toISOString(),
    database_repo: config.databaseFull || `${config.owner}/${config.databaseRepo}`,
    note: 'Single rotating backup. Previous latest.zip is overwritten.',
    apis,
    objects,
    data_repos: config.dataRepos,
  };
  const gz = zlib.gzipSync(Buffer.from(JSON.stringify(bundle, null, 2)));
  await engine.writeDb('rotate backup latest.zip', [
    {
      path: BACKUP_PATH,
      contentBase64: gz.toString('base64'),
    },
    {
      path: 'backups/latest.json',
      contentUtf8: JSON.stringify({
        created_at: bundle.created_at,
        apis: apis.length,
        objects: objects.length,
        bytes: gz.length,
        path: BACKUP_PATH,
        policy: 'overwrite-only',
      }, null, 2),
    },
  ]);
  return {
    path: BACKUP_PATH,
    bytes: gz.length,
    apis: apis.length,
    objects: objects.length,
    created_at: bundle.created_at,
    policy: 'overwrite-only',
  };
}

module.exports = { createLatestBackup, BACKUP_PATH };
