const crypto = require('crypto');
const tls = require('tls');
const catalog = require('./faces');
const { sha256, encryptSecret, decryptSecret } = require('../utils/hash');

function otpCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

async function getSmtp(apiId) {
  const rec = await catalog.readFace(apiId, 'secrets/smtp.json');
  if (!rec || !rec.password_enc) return null;
  return {
    host: rec.host || 'smtp.gmail.com',
    port: rec.port || 465,
    user: rec.user,
    pass: decryptSecret(rec.password_enc),
    from: rec.from || rec.user,
  };
}

async function setSmtp(apiId, { host, port, user, password, from }) {
  if (!user || !password) {
    const e = new Error('SMTP user and app password required');
    e.status = 422; e.code = 'INVALID_REQUEST';
    throw e;
  }
  const rec = {
    host: host || 'smtp.gmail.com',
    port: port || 465,
    user,
    from: from || user,
    password_enc: encryptSecret(password),
    updated_at: catalog.nowIso(),
  };
  await catalog.writeFace(apiId, 'set smtp secret', [{ path: 'secrets/smtp.json', content: rec }]);
  return { ok: true, user, host: rec.host };
}

function smtpSend({ host, port, user, pass, from, to, subject, text }) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect(port || 465, host || 'smtp.gmail.com', { servername: host || 'smtp.gmail.com' }, () => {
      const lines = [];
      const send = (s) => socket.write(s + '\r\n');
      let step = 0;
      socket.on('data', (buf) => {
        const chunk = buf.toString();
        lines.push(chunk);
        const last = chunk.trim().split('\n').pop() || '';
        if (!/^\d{3}[\s-]/.test(last) && step > 0) return;
        try {
          if (step === 0) { send('EHLO gitdb'); step = 1; return; }
          if (step === 1) { send('AUTH LOGIN'); step = 2; return; }
          if (step === 2) { send(Buffer.from(user).toString('base64')); step = 3; return; }
          if (step === 3) { send(Buffer.from(pass).toString('base64')); step = 4; return; }
          if (step === 4) { send(`MAIL FROM:<${from}>`); step = 5; return; }
          if (step === 5) { send(`RCPT TO:<${to}>`); step = 6; return; }
          if (step === 6) { send('DATA'); step = 7; return; }
          if (step === 7) {
            send(`Subject: ${subject}\r\nFrom: ${from}\r\nTo: ${to}\r\n\r\n${text}\r\n.`);
            step = 8;
            return;
          }
          if (step === 8) { send('QUIT'); socket.end(); resolve({ ok: true }); }
        } catch (err) {
          reject(err);
        }
      });
    });
    socket.setTimeout(20000, () => { socket.destroy(); reject(new Error('SMTP timeout')); });
    socket.on('error', reject);
  });
}

async function startOtp(apiId, email) {
  const mail = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) {
    const e = new Error('Valid email required');
    e.status = 422; e.code = 'INVALID_REQUEST';
    throw e;
  }
  const id = catalog.emailHash(mail);
  const prev = await catalog.readFace(apiId, `auth/otp/${id}.json`);
  if (prev && prev.sent_at && Date.now() - new Date(prev.sent_at).getTime() < 60 * 1000) {
    const e = new Error('Wait before requesting another OTP');
    e.status = 429; e.code = 'RATE_LIMITED';
    throw e;
  }
  const code = otpCode();
  const rec = {
    email_hash: id,
    otp_hash: sha256(Buffer.from(code + ':' + id)),
    tries: 0,
    sent_at: catalog.nowIso(),
    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  };
  await catalog.writeFace(apiId, 'otp start', [{ path: `auth/otp/${id}.json`, content: rec }]);
  const smtp = await getSmtp(apiId);
  let sent = false;
  let reason = 'SMTP_NOT_CONFIGURED';
  if (smtp && smtp.pass) {
    try {
      await smtpSend({
        ...smtp,
        to: mail,
        subject: 'Your GitDB login code',
        text: `Your one-time code is ${code}. It expires in 10 minutes.`,
      });
      sent = true;
      reason = null;
    } catch (err) {
      reason = err.message || 'SMTP_FAILED';
    }
  }
  return { started: true, sent, expires_at: rec.expires_at, reason };
}

async function verifyOtp(apiId, email, code) {
  const mail = String(email || '').trim().toLowerCase();
  const id = catalog.emailHash(mail);
  const rec = await catalog.readFace(apiId, `auth/otp/${id}.json`);
  if (!rec) {
    const e = new Error('OTP not found');
    e.status = 404; e.code = 'NOT_FOUND';
    throw e;
  }
  if (new Date(rec.expires_at).getTime() < Date.now()) {
    const e = new Error('OTP expired');
    e.status = 401; e.code = 'OTP_EXPIRED';
    throw e;
  }
  rec.tries = (rec.tries || 0) + 1;
  if (rec.tries > 5) {
    const e = new Error('Too many tries');
    e.status = 429; e.code = 'RATE_LIMITED';
    throw e;
  }
  const expect = sha256(Buffer.from(String(code) + ':' + id));
  if (expect !== rec.otp_hash) {
    await catalog.writeFace(apiId, 'otp try', [{ path: `auth/otp/${id}.json`, content: rec }]);
    const e = new Error('Wrong OTP');
    e.status = 401; e.code = 'OTP_INVALID';
    throw e;
  }
  const token = crypto.randomBytes(24).toString('hex');
  const session = {
    token_hash: sha256(Buffer.from(token)),
    email_hash: id,
    created_at: catalog.nowIso(),
    expires_at: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
  };
  const user = { email_hash: id, last_login: catalog.nowIso() };
  rec.otp_hash = 'used';
  rec.used_at = catalog.nowIso();
  await catalog.writeFace(apiId, 'otp verify', [
    { path: `auth/otp/${id}.json`, content: rec },
    { path: `auth/users/${id}.json`, content: user },
    { path: `auth/sessions/${session.token_hash.slice(0, 24)}.json`, content: session },
  ]);
  return { token, expires_at: session.expires_at };
}

module.exports = { startOtp, verifyOtp, setSmtp, getSmtp };
