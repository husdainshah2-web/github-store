const config = require('../config');
const engine = require('../db/engine');
const ops = require('./ops');

const DAY_MS = 24 * 60 * 60 * 1000;

function expired(obj) {
  const at = obj.deleted_at || obj.updated_at;
  if (!at) return false;
  const age = Date.now() - new Date(at).getTime();
  return age > config.recycleDays * DAY_MS;
}

async function sweepTrash() {
  const apis = await engine.listApis();
  const report = { checked: 0, purged: 0, kept: 0, errors: [] };
  for (const a of apis) {
    const ids = await engine.listObjectIdsForApi(a.api_id);
    // also scan known cache objects marked trash
    for (const id of ids) {
      const obj = await engine.getObject(id);
      if (!obj) continue;
      report.checked += 1;
      if (obj.status !== 'trash' && obj.status !== 'deleted') continue;
      if (!expired(obj)) {
        report.kept += 1;
        continue;
      }
      try {
        await ops.purgeObject({ api_id: 'admin', role: 'admin' }, obj.object_id);
        report.purged += 1;
      } catch (err) {
        report.errors.push({ id: obj.object_id, error: err.message });
      }
    }
  }
  return report;
}

function startRecycleWorker() {
  const tick = async () => {
    try {
      const r = await sweepTrash();
      if (r.purged) console.log('Recycle sweep', r);
    } catch (err) {
      console.error('Recycle sweep failed:', err.message);
    }
  };
  setTimeout(tick, 20 * 1000);
  setInterval(tick, 6 * 60 * 60 * 1000);
}

module.exports = { sweepTrash, expired, startRecycleWorker };
