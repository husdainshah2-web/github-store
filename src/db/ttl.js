const EXEMPT = new Set(['orders', 'payments', 'pay_events', 'refunds']);

function isExemptCollection(name) {
  return EXEMPT.has(String(name || ''));
}

module.exports = { EXEMPT, isExemptCollection };
