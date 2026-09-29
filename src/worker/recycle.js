const config = require('../config');
const engine = require('../db/engine');
const ops = require('./ops');

const DAY_MS = 24 * 60 * 60 * 1000;

function expired(obj) {
  const days = config.recycleDays || 15;
  const limit = days * DAY_MS;
  const exp = obj.expires_at ? new Date(obj.expires_at).getTime() : NaN;
  if (!Number.isNaN(exp)) return Date.now() > exp;
  const at = obj.created_at || obj.updated_at || obj.deleted_at;
  if (!at) return false;
  return Date.now() - new Date(at).getTime() > limit;
}

async function sweepTrash() {
  const apis = await engine.listApis();
  const report = { checked: 0, purged: 0, kept: 0, errors: [] };
  for (const a of apis) {
    const ids = await engine.listObjectIdsForApi(a.api_id);
    for (const id of ids) {
      const obj = await engine.getObject(id);
      if (!obj) continue;
      report.checked += 1;
      if (!expired(obj) && obj.status !== 'deleted') {
        report.kept += 1;
        continue;
      }
      if (!expired(obj) && (obj.status === 'trash' || obj.status === 'deleted')) {
        report.kept += 1;
        continue;
      }
      if (!expired(obj)) { report.kept += 1; continue; }
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
      if (r.purged) console.log('TTL sweep', r);
    } catch (err) {
      console.error('TTL sweep failed:', err.message);
    }
  };
  setTimeout(tick, 20 * 1000);
  setInterval(tick, 6 * 60 * 60 * 1000);
}

module.exports = { sweepTrash, expired, startRecycleWorker };
