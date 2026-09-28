class TtlCache {
  constructor({ max = 500, ttlMs = 30000 } = {}) {
    this.max = max;
    this.ttlMs = ttlMs;
    this.map = new Map();
  }

  _expired(entry) {
    return Date.now() > entry.exp;
  }

  get(key) {
    const e = this.map.get(key);
    if (!e) return undefined;
    if (this._expired(e)) {
      this.map.delete(key);
      return undefined;
    }
    this.map.delete(key);
    this.map.set(key, e);
    return e.value;
  }

  set(key, value, ttlMs) {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, { value, exp: Date.now() + (ttlMs || this.ttlMs) });
    while (this.map.size > this.max) {
      const first = this.map.keys().next().value;
      this.map.delete(first);
    }
  }

  del(key) {
    this.map.delete(key);
  }

  delPrefix(prefix) {
    for (const k of this.map.keys()) {
      if (String(k).startsWith(prefix)) this.map.delete(k);
    }
  }

  clear() {
    this.map.clear();
  }

  stats() {
    return { size: this.map.size, max: this.max, ttlMs: this.ttlMs };
  }
}

const inflight = new Map();

function coalesce(key, fn) {
  if (inflight.has(key)) return inflight.get(key);
  const p = Promise.resolve().then(fn).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

module.exports = { TtlCache, coalesce, inflight };
