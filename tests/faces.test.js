const { parseSql } = require('../src/db/sqlmini');
const { validateRow } = require('../src/db/faces');
const assert = require('assert');

const q = parseSql("SELECT * FROM bookings WHERE date = '2026-10-10' LIMIT 5");
assert.strictEqual(q.collection, 'bookings');
assert.strictEqual(q.where[0].field, 'date');
assert.strictEqual(q.where[0].value, '2026-10-10');
assert.strictEqual(q.limit, 5);

let threw = false;
try { parseSql('DROP TABLE bookings'); } catch (e) { threw = true; }
assert.strictEqual(threw, true);

const errs = validateRow({ fields: { name: { type: 'string', required: true } } }, {});
assert.ok(errs.length === 1);
console.log('faces unit ok');
