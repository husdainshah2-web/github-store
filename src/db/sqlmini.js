const catalog = require('./faces');

function parseSql(q) {
  let sql = String(q || '').trim().replace(/\s+/g, ' ');
  let limit = 20;
  const lim = sql.match(/\sLIMIT\s+(\d+)\s*$/i);
  if (lim) {
    limit = Math.min(100, Math.max(1, parseInt(lim[1], 10)));
    sql = sql.slice(0, lim.index).trim();
  }
  const select = /^SELECT \* FROM ([a-zA-Z0-9._-]+)(?: WHERE ([a-zA-Z0-9._-]+)\s*(=|!=|<>)\s*(.+))?$/i;
  const m = sql.match(select);
  if (!m) {
    const e = new Error('Only SELECT * FROM collection [WHERE field = value] [LIMIT n] is allowed');
    e.status = 422; e.code = 'SQL_UNSUPPORTED';
    throw e;
  }
  let value = (m[4] || '').trim();
  if ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"'))) {
    value = value.slice(1, -1);
  } else if (value && /^-?\d+(\.\d+)?$/.test(value)) {
    value = Number(value);
  }
  const op = !m[3] ? null : (m[3] === '!=' || m[3] === '<>' ? 'neq' : 'eq');
  return {
    collection: catalog.sanitizeCollection(m[1]),
    where: m[2] ? [{ field: m[2], op, value }] : [],
    limit,
  };
}

module.exports = { parseSql };
