const state = { writeMode: 'NORMAL' }; // NORMAL | READ_ONLY | LOCKED

function canWrite() {
  return state.writeMode === 'NORMAL';
}

function setMode(m) {
  if (!['NORMAL', 'READ_ONLY', 'LOCKED', 'MAINTENANCE'].includes(m)) return state.writeMode;
  state.writeMode = m;
  return state.writeMode;
}

function guardWrite(req, res, next) {
  if (!canWrite()) {
    return res.status(503).json({
      success: false,
      error: { code: 'READ_ONLY', message: 'Writes are locked: ' + state.writeMode },
    });
  }
  next();
}

module.exports = { state, canWrite, setMode, guardWrite };
