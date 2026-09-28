const assert = require('assert');

function assertOwner(api, obj) {
  if (!obj || obj.status === 'deleted') {
    const e = new Error('OBJECT_NOT_FOUND');
    e.status = 404;
    throw e;
  }
  if (api.role !== 'admin' && obj.api_id !== api.api_id) {
    const e = new Error('OBJECT_NOT_FOUND');
    e.status = 404;
    throw e;
  }
}

const objA = { object_id: 'obj_a', api_id: 'api_a', status: 'active' };
const apiA = { api_id: 'api_a' };
const apiB = { api_id: 'api_b' };

assertOwner(apiA, objA);
let denied = 0;
for (const op of ['GET', 'HEAD', 'DELETE', 'PATCH', 'PUT', 'RENAME']) {
  try {
    assertOwner(apiB, objA);
  } catch (err) {
    assert.strictEqual(err.status, 404);
    denied += 1;
  }
}
assert.strictEqual(denied, 6);

const { storedName } = { storedName: (f) => String(f || 'file.bin').replace(/[^a-zA-Z0-9._-]/g, '_') || 'file.bin' };
assert.ok(!storedName('../etc/passwd').includes('..'));
assert.ok(!storedName('a;rm -rf').includes(';'));
console.log('isolation tests passed');
