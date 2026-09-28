const engine = require('./engine');

function cmp(fieldVal, op, value) {
  if (op === 'exists') return fieldVal !== undefined && fieldVal !== null;
  if (fieldVal == null) return false;
  if (op === 'eq') return fieldVal === value;
  if (op === 'neq') return fieldVal !== value;
  if (op === 'gt') return fieldVal > value;
  if (op === 'gte') return fieldVal >= value;
  if (op === 'lt') return fieldVal < value;
  if (op === 'lte') return fieldVal <= value;
  if (op === 'contains') return String(fieldVal).includes(String(value));
  if (op === 'starts_with') return String(fieldVal).startsWith(String(value));
  if (op === 'ends_with') return String(fieldVal).endsWith(String(value));
  if (op === 'in') return Array.isArray(value) && value.includes(fieldVal);
  if (op === 'between' && Array.isArray(value) && value.length === 2) {
    return fieldVal >= value[0] && fieldVal <= value[1];
  }
  return false;
}

function fieldOf(obj, field) {
  if (!field) return undefined;
  if (Object.prototype.hasOwnProperty.call(obj, field)) return obj[field];
  if (obj.custom_metadata && Object.prototype.hasOwnProperty.call(obj.custom_metadata, field)) {
    return obj.custom_metadata[field];
  }
  if (field === 'tag' && Array.isArray(obj.tags)) return obj.tags;
  return undefined;
}

async function queryApi(apiId, { collection, where = [], sort, limit = 50, cursor = 0, scanLimit = 500 } = {}) {
  const ids = await engine.listObjectIdsForApi(apiId);
  const start = Math.max(0, parseInt(cursor, 10) || 0);
  const cap = Math.min(scanLimit, ids.length);
  const items = [];
  let scanned = 0;
  for (let i = start; i < ids.length && scanned < cap && items.length < limit; i += 1) {
    scanned += 1;
    const obj = await engine.getObject(ids[i]);
    if (!obj || obj.status === 'deleted' || obj.status === 'trash') continue;
    if (collection && obj.collection !== collection) continue;
    let ok = true;
    for (const clause of where) {
      const val = fieldOf(obj, clause.field);
      if (clause.field === 'tag' && Array.isArray(obj.tags)) {
        if (!obj.tags.includes(clause.value)) { ok = false; break; }
        continue;
      }
      if (!cmp(val, clause.op || 'eq', clause.value)) { ok = false; break; }
    }
    if (ok) items.push(obj);
  }
  if (sort && sort.created_at === 'desc') items.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  if (sort && sort.created_at === 'asc') items.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  return { items, scanned, next_cursor: start + scanned < ids.length ? start + scanned : null, total_ids: ids.length };
}

module.exports = { queryApi, cmp, fieldOf };
