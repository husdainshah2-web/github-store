const state = {
  remaining: null,
  limit: null,
  reset: null,
  lastStatus: null,
  retryAfter: null,
};

function capture(res) {
  if (!res || !res.headers) return;
  const rem = res.headers.get && res.headers.get('x-ratelimit-remaining');
  const lim = res.headers.get && res.headers.get('x-ratelimit-limit');
  const reset = res.headers.get && res.headers.get('x-ratelimit-reset');
  const retry = res.headers.get && res.headers.get('retry-after');
  if (rem != null) state.remaining = parseInt(rem, 10);
  if (lim != null) state.limit = parseInt(lim, 10);
  if (reset != null) state.reset = parseInt(reset, 10);
  if (retry != null) state.retryAfter = parseInt(retry, 10);
  state.lastStatus = res.status;
}

function snapshot() {
  return { ...state, now: Math.floor(Date.now() / 1000) };
}

module.exports = { state, capture, snapshot };
