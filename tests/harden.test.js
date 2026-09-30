const assert = require('assert');
const { safeEqual } = require('../src/security/harden');
assert.strictEqual(safeEqual('abc', 'abc'), true);
assert.strictEqual(safeEqual('abc', 'abd'), false);
assert.strictEqual(safeEqual('abc', 'ab'), false);
console.log('harden unit ok');
