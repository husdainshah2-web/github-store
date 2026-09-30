const assert = require('assert');
const { canTransition } = require('../src/db/paystate');
const { scanBody, luhn } = require('../src/security/pan');

assert.strictEqual(canTransition('PENDING', 'PAID'), true);
assert.strictEqual(canTransition('FAILED', 'PAID'), false);
assert.strictEqual(canTransition('PAID', 'REFUNDED'), true);
assert.strictEqual(luhn('4111111111111111'), true);
assert.ok(scanBody({ card_number: '4111111111111111' }).length > 0);
assert.strictEqual(scanBody({ order_id: 'ORD-99' }).length, 0);
console.log('pay/pan unit ok');
