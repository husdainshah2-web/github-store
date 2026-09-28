const assert = require('assert');
const { TtlCache, coalesce } = require('../src/cache/lru');

async function run() {
  const c = new TtlCache({ max: 2, ttlMs: 50 });
  c.set('a', 1);
  assert.strictEqual(c.get('a'), 1);
  c.set('b', 2);
  c.set('c', 3);
  assert.strictEqual(c.get('a'), undefined);
  let n = 0;
  const p1 = coalesce('k', async () => { n += 1; return 7; });
  const p2 = coalesce('k', async () => { n += 1; return 8; });
  const [x, y] = await Promise.all([p1, p2]);
  assert.strictEqual(x, 7);
  assert.strictEqual(y, 7);
  assert.strictEqual(n, 1);
  console.log('cache tests passed');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
