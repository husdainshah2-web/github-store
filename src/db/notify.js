const catalog = require('./faces');
const { objectId } = require('../utils/ids');

async function addNotify(apiId, { title, body, user, topic }) {
  const id = objectId();
  const rec = {
    id,
    title: String(title || 'Notice').slice(0, 120),
    body: String(body || '').slice(0, 2000),
    user: user ? String(user).slice(0, 80) : null,
    topic: topic ? String(topic).slice(0, 40) : 'general',
    read: false,
    created_at: catalog.nowIso(),
    expires_at: new Date(Date.now() + 15 * 24 * 3600 * 1000).toISOString(),
  };
  await catalog.writeFace(apiId, 'notify', [{ path: `notify/${id}.json`, content: rec }]);
  return rec;
}

async function listNotify(apiId, topic) {
  const idx = (await catalog.readFace(apiId, 'notify/_index.json')) || { ids: [] };
  const items = [];
  for (const id of (idx.ids || []).slice(0, 50)) {
    const row = await catalog.readFace(apiId, `notify/${id}.json`);
    if (!row || new Date(row.expires_at).getTime() <= Date.now()) continue;
    if (topic && row.topic !== topic) continue;
    items.push(row);
  }
  return items;
}

async function pushIndex(apiId, id) {
  const idx = (await catalog.readFace(apiId, 'notify/_index.json')) || { ids: [] };
  idx.ids = [id].concat((idx.ids || []).filter((x) => x !== id)).slice(0, 200);
  await catalog.writeFace(apiId, 'notify index', [{ path: 'notify/_index.json', content: idx }]);
}

async function sendNotify(apiId, payload) {
  const rec = await addNotify(apiId, payload);
  await pushIndex(apiId, rec.id);
  return rec;
}

async function markRead(apiId, id) {
  const row = await catalog.readFace(apiId, `notify/${id}.json`);
  if (!row) {
    const e = new Error('Notification not found');
    e.status = 404; e.code = 'NOT_FOUND';
    throw e;
  }
  row.read = true;
  row.read_at = catalog.nowIso();
  await catalog.writeFace(apiId, 'notify read', [{ path: `notify/${id}.json`, content: row }]);
  return row;
}

module.exports = { sendNotify, listNotify, markRead };
