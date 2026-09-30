const ALLOWED = {
  CREATED: ['PENDING'],
  PENDING: ['FAILED', 'CANCELLED', 'AUTHORIZED', 'PAID'],
  AUTHORIZED: ['PAID', 'FAILED'],
  PAID: ['REFUND_PENDING', 'REFUNDED', 'PARTIALLY_REFUNDED'],
  REFUND_PENDING: ['REFUNDED', 'PARTIALLY_REFUNDED', 'PAID'],
  PARTIALLY_REFUNDED: ['REFUND_PENDING', 'REFUNDED'],
  FAILED: [],
  CANCELLED: [],
  REFUNDED: [],
  REJECTED: [],
};

function canTransition(from, to) {
  const cur = String(from || 'CREATED').toUpperCase();
  const next = String(to || '').toUpperCase();
  return (ALLOWED[cur] || []).includes(next);
}

function assertTransition(from, to) {
  if (!canTransition(from, to)) {
    const e = new Error(`Illegal payment transition ${from} → ${to}`);
    e.status = 409;
    e.code = 'ILLEGAL_STATE';
    throw e;
  }
}

module.exports = { ALLOWED, canTransition, assertTransition };
