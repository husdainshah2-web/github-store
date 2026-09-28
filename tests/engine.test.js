const assert = require('assert');
const { repoIndex, chooseRepo } = require('../src/storage/router');
const { shard } = require('../src/utils/ids');
const { sha256, hashKey } = require('../src/utils/hash');

assert.strictEqual(typeof repoIndex('obj_abc'), 'number');
assert.ok(String(chooseRepo('obj_abc').repo).includes('ghs-data-'));
assert.deepStrictEqual(shard('obj_7f91c2a8'), { a: '7f', b: '91' });
assert.strictEqual(sha256(Buffer.from('abc')).length, 64);
assert.notStrictEqual(hashKey('a'), hashKey('b'));
console.log('engine tests passed');
