
const API = '/admin/api';
let token = localStorage.getItem('adminToken');
const PAGES = [
  ['overview','Overview'],['explorer','Explorer'],['objects','Objects'],['collections','Collections'],
  ['query','Query'],['faces','Faces'],['apis','APIs'],['repos','Repositories'],['transactions','Transactions'],
  ['recycle','Recycle Bin'],['security','Security'],['audit','Audit'],
  ['performance','Performance'],['console','Console'],['playground','Playground'],
  ['doctor','System Doctor'],['reconcile','Reconciliation'],['settings','Settings']
];

function toast(msg) {
  const box = document.getElementById('toast');
  const el = document.createElement('div');
  el.className = 'card px-3 py-2 text-sm';
  el.textContent = msg;
  box.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(API + path, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) {
    const msg = (data.error && data.error.message) || data.message || ('HTTP ' + res.status);
    throw new Error(msg);
  }
  return data.data;
}

function card(label, value, extra='') {
  return `<div class="card p-4"><div class="k">${label}</div><div class="text-2xl font-semibold mt-1">${value}</div><div class="text-xs text-slate-500 mt-1">${extra}</div></div>`;
}

function showApp() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app-shell').classList.remove('hidden');
  const nav = document.getElementById('nav');
  nav.innerHTML = PAGES.map(([id,label]) => `<button class="nav-btn" data-page="${id}">${label}</button>`).join('');
  nav.querySelectorAll('.nav-btn').forEach(b => b.onclick = () => go(b.dataset.page));
  document.getElementById('quick-actions').innerHTML = `
    <button id="qa-api" class="text-xs px-3 py-1.5 rounded-lg bg-teal-500 text-black font-semibold">Create API</button>
    <button id="qa-doc" class="text-xs px-3 py-1.5 rounded-lg bg-[#12151c] border border-white/10">Doctor</button>`;
  document.getElementById('qa-api').onclick = createApi;
  document.getElementById('qa-doc').onclick = () => go('doctor');
  document.getElementById('write-mode').onchange = async (e) => {
    await api('/mode', { method:'POST', body: JSON.stringify({ mode: e.target.value }) });
    document.getElementById('lock-banner').classList.toggle('hidden', e.target.value === 'NORMAL');
    toast('Write mode: ' + e.target.value);
  };
  pingHealth();
  go('overview');
}

async function pingHealth() {
  try {
    const h = await fetch('/health').then(r => r.json());
    document.getElementById('dot-server').classList.toggle('bad', false);
    document.getElementById('dot-github').classList.toggle('warn', Boolean(h.github_rate && h.github_rate.remaining === 0));
    document.getElementById('dot-db').classList.toggle('bad', !h.database);
    document.getElementById('dot-worker').classList.toggle('bad', h.ready === false);
  } catch (e) {
    document.getElementById('dot-server').classList.add('bad');
  }
}

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = document.getElementById('login-err');
  try {
    const data = await api('/login', { method:'POST', body: JSON.stringify({
      username: document.getElementById('user').value,
      password: document.getElementById('pass').value
    })});
    token = data.token;
    localStorage.setItem('adminToken', token);
    showApp();
  } catch (ex) {
    err.textContent = ex.message;
    err.classList.remove('hidden');
  }
});

if (token) showApp();

const COMMANDS = PAGES.map(([id,label]) => ({ label: 'Open ' + label, run: () => go(id) })).concat([
  { label: 'Create API', run: createApi },
  { label: 'Rebuild Index', run: async () => { await api('/rebuild-index',{method:'POST'}); toast('Indexes rebuilt'); } },
  { label: 'Emergency Lock', run: async () => { await api('/mode',{method:'POST', body: JSON.stringify({mode:'LOCKED'})}); toast('Writes locked'); } }
]);

function openPalette() {
  const pal = document.getElementById('palette');
  pal.classList.remove('hidden');
  const input = document.getElementById('palette-input');
  input.value = '';
  renderPalette('');
  input.focus();
}
function renderPalette(q) {
  const list = COMMANDS.filter(c => c.label.toLowerCase().includes(q.toLowerCase()));
  document.getElementById('palette-list').innerHTML = list.map((c,i) =>
    `<button data-i="${i}" class="w-full text-left px-4 py-2 text-sm hover:bg-white/5">${c.label}</button>`
  ).join('');
  document.getElementById('palette-list').querySelectorAll('button').forEach((b,i) => {
    b.onclick = () => { document.getElementById('palette').classList.add('hidden'); list[i].run(); };
  });
}
document.getElementById('open-search').onclick = openPalette;
document.getElementById('palette-input').addEventListener('input', (e) => renderPalette(e.target.value));
document.getElementById('palette').addEventListener('click', (e) => {
  if (e.target.id === 'palette') e.currentTarget.classList.add('hidden');
});
window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); }
  if (e.key === 'Escape') document.getElementById('palette').classList.add('hidden');
});
document.getElementById('sidebar-toggle').onclick = () => document.getElementById('sidebar').classList.toggle('hidden');

async function createApi() {
  const name = prompt('API name');
  if (!name) return;
  const created = await api('/apis', { method:'POST', body: JSON.stringify({ name }) });
  alert('Save this API key now:\n' + created.api_key);
  go('apis');
}

async function go(page) {
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.page === page));
  const title = (PAGES.find(p => p[0] === page) || [page,page])[1];
  document.getElementById('page-title').textContent = title;
  document.getElementById('page-sub').textContent = 'GitDB · Repo 10 is the database · Repos 1–9 are storage';
  const el = document.getElementById('content');
  el.innerHTML = '<div class="text-slate-500 text-sm">Loading…</div>';
  try {
    if (page === 'overview') return overview(el);
    if (page === 'explorer') return explorer(el);
    if (page === 'objects') return objects(el);
    if (page === 'collections') return collections(el);
    if (page === 'query') return queryPage(el);
    if (page === 'faces') return facesPage(el);
    if (page === 'apis') return apis(el);
    if (page === 'repos') return repos(el);
    if (page === 'transactions') return el.innerHTML = empty('Transactions persist in Repo 10 under transactions/');
    if (page === 'recycle') return recycle(el);
    if (page === 'security') return security(el);
    if (page === 'audit') return el.innerHTML = empty('Mutation events are batched into Repo 10 audit shards.');
    if (page === 'performance') return performance(el);
    if (page === 'console') return consolePage(el);
    if (page === 'playground') return playground(el);
    if (page === 'doctor') return doctor(el);
    if (page === 'reconcile') return el.innerHTML = empty('Run System Doctor, then verify individual objects from the Objects page.');
    if (page === 'settings') return settings(el);
  } catch (ex) {
    el.innerHTML = `<div class="card p-4 text-red-300">${ex.message}</div>`;
  }
}

function empty(msg) {
  return `<div class="card p-10 text-center text-slate-400">${msg}</div>`;
}

async function overview(el) {
  const [d, health] = await Promise.all([api('/overview'), fetch('/health').then(r=>r.json())]);
  const remaining = (health.github_rate && health.github_rate.remaining != null) ? health.github_rate.remaining : '—';
  el.innerHTML = `
    <div class="grid md:grid-cols-4 gap-3 mb-6">
      ${card('APIs', d.apis, 'isolated tenants')}
      ${card('Objects', d.objects, 'live metadata')}
      ${card('Data repos', d.data_repos, 'content shards')}
      ${card('GitHub remaining', remaining, 'REST budget')}
    </div>
    <div class="grid lg:grid-cols-2 gap-4 mb-6">
      <div class="card p-5">
        <div class="k mb-3">Architecture</div>
        <div class="text-sm leading-7">
          <div>Client → API key → Engine</div>
          <div class="text-teal-300">Repo 10 DATABASE</div>
          <div class="text-slate-500">indexes · metadata · transactions</div>
          <div>Storage router</div>
          <div class="grid grid-cols-3 gap-2 mt-3">${(d.repos||[]).filter(r=>r.role==='data').map(r=>`<div class="bg-[#12151c] rounded-lg p-2 text-xs">${r.name.replace('ghs-data-','R')}</div>`).join('')}</div>
        </div>
      </div>
      <div class="card p-5">
        <div class="k mb-3">Repository heatmap</div>
        <div class="grid grid-cols-3 gap-2">${(d.repos||[]).map(r=>`<div class="bg-[#12151c] rounded-lg p-3"><div class="text-xs text-slate-500">${r.role}</div><div class="text-sm">${r.name}</div><div class="text-[11px] text-slate-500">${r.size_kb||0} KB</div></div>`).join('')}</div>
      </div>
    </div>`;
}

async function apis(el) {
  const list = await api('/apis');
  el.innerHTML = `<div id="keybox" class="hidden mb-3 card p-3 text-sm break-all"></div>
    <div class="card overflow-hidden">
      <table class="w-full text-sm"><thead class="text-slate-500 text-left"><tr><th class="p-3">Name</th><th>ID</th><th>Status</th><th>Objects</th><th></th></tr></thead>
      <tbody>${list.map(a=>`<tr class="border-t border-white/5 openapi" data-id="${a.api_id}" style="cursor:pointer">
        <td class="p-3">${a.name}</td><td class="mono text-xs">${a.api_id}</td>
        <td>${a.status}</td><td>${a.object_count||0}</td>
        <td class="p-3 text-right" onclick="event.stopPropagation()">
          <button data-id="${a.api_id}" data-st="${a.status}" class="tog text-xs px-2 py-1 bg-[#12151c] rounded">Toggle</button>
          <button data-id="${a.api_id}" class="rot text-xs px-2 py-1 bg-[#12151c] rounded">Rotate</button>
          <button data-id="${a.api_id}" data-name="${a.name}" class="del text-xs px-2 py-1 bg-red-900/40 rounded">Delete</button>
        </td>
      </tr>`).join('')||''}</tbody></table>
    </div>${list.length? '':'<div class="mt-4">'+empty('No APIs yet. Create your first API.')+'</div>'}`;
  el.querySelectorAll('.openapi').forEach(row => row.onclick = async () => {
    const d = await api('/apis/'+row.dataset.id);
    const box = document.getElementById('keybox');
    box.classList.remove('hidden');
    box.innerHTML = `<div class="text-xs text-slate-500 mb-1">${d.name} · ${d.api_id}</div><div class="mono text-teal-300">${d.api_key || 'Purani API — Rotate dabao, naya dtbsprsl key milega'}</div><button id="copykey" class="mt-2 text-xs px-2 py-1 bg-[#12151c] rounded">Copy key</button>`;
    const btn = document.getElementById('copykey');
    if (btn && d.api_key) btn.onclick = async () => { await navigator.clipboard.writeText(d.api_key); toast('Key copied'); };
  });
  el.querySelectorAll('.tog').forEach(b => b.onclick = async () => {
    const path = b.dataset.st === 'active' ? '/disable' : '/enable';
    await api('/apis/'+b.dataset.id+path, {method:'POST'});
    go('apis');
  });
  el.querySelectorAll('.rot').forEach(b => b.onclick = async () => {
    const r = await api('/apis/'+b.dataset.id+'/rotate-key', {method:'POST'});
    alert('New key:\n'+r.api_key);
    go('apis');
  });
  el.querySelectorAll('.del').forEach(b => b.onclick = async () => {
    if (!confirm('Delete API '+b.dataset.name+'? This cannot be undone from the list.')) return;
    await api('/apis/'+b.dataset.id, {method:'DELETE'});
    toast('API deleted');
    go('apis');
  });
}

async function objects(el) {
  const d = await api('/objects');
  const items = d.items || [];
  el.innerHTML = items.length ? `<div class="card overflow-auto"><table class="w-full text-sm">
    <thead class="text-slate-500 text-left"><tr><th class="p-3">Object</th><th>File</th><th>API</th><th>Repo</th><th>Size</th><th>Status</th></tr></thead>
    <tbody>${items.map(o=>`<tr class="border-t border-white/5 hover:bg-white/[.03]">
      <td class="p-3 mono text-xs">${o.object_id}</td><td>${o.filename||''}</td>
      <td class="mono text-xs">${o.api_id}</td><td class="mono text-xs">${o.repository_id||''}</td>
      <td>${o.size||0}</td><td>${o.status}</td></tr>`).join('')}</tbody></table></div>` : empty('No objects. Upload through the API playground.');
}

async function collections(el) {
  const d = await api('/objects');
  const map = {};
  (d.items||[]).forEach(o => { const c=o.collection||'default'; map[c]=(map[c]||0)+1; });
  const names = Object.keys(map);
  el.innerHTML = names.length ? `<div class="grid md:grid-cols-3 gap-3">${names.map(n=>`<div class="card p-4"><div class="text-slate-400 text-xs">collection</div><div class="text-lg">${n}</div><div class="text-sm text-slate-500">${map[n]} objects</div></div>`).join('')}</div>` : empty('Collections appear after objects are stored.');
}

async function explorer(el) {
  const [apisList, objs] = await Promise.all([api('/apis'), api('/objects')]);
  el.innerHTML = `<div class="grid lg:grid-cols-3 gap-4">
    <div class="card p-4"><div class="k mb-2">Logical view</div>${apisList.map(a=>`<div class="mb-2"><div class="text-sm">${a.name}</div><div class="mono text-[11px] text-slate-500">${a.api_id}</div></div>`).join('')||'No APIs'}</div>
    <div class="lg:col-span-2 card p-4"><div class="k mb-2">Physical view</div>
      ${(objs.items||[]).slice(0,20).map(o=>`<div class="py-2 border-b border-white/5 text-xs"><span class="mono">${o.object_id}</span> · ${o.repository_id} · <span class="text-slate-500">${o.path||''}</span></div>`).join('')||'No objects'}
    </div></div>`;
}

async function facesPage(el) {
  let policy = null;
  try { policy = await api('/policy'); } catch (e) { policy = { error: e.message }; }
  el.innerHTML = `<div class="grid md:grid-cols-2 gap-3 mb-4">
    ${card('Backend', 'GitHub repos only', 'No SQLite / Firebase / Redis')}
    ${card('TTL', (policy && policy.recycle_days) || 15, 'days then purge')}
    ${card('Backup', (policy && policy.backup_policy) || 'disabled', 'history off')}
    ${card('Max file', policy && policy.max_file_size ? Math.round(policy.max_file_size/1024/1024)+' MB' : '90 MB', 'hard cap')}
  </div>
  <div class="card p-4 text-sm leading-7">
    <div class="k mb-2">Real faces (API key on /v1)</div>
    <div>Docs <span class="mono text-teal-300">/v1/data/:collection</span></div>
    <div>Schema <span class="mono text-teal-300">/v1/schema/:collection</span></div>
    <div>KV <span class="mono text-teal-300">/v1/kv/:key</span></div>
    <div>SQL-lite <span class="mono text-teal-300">POST /v1/sql</span></div>
    <div>OTP <span class="mono text-teal-300">/v1/auth/otp/start</span> — mail only if SMTP saved</div>
    <div>Notify <span class="mono text-teal-300">/v1/notify</span></div>
    <div>Count / explain are GitHub scans, not estimates.</div>
    <div>Pay <span class="mono text-teal-300">POST /v1/pay/intent</span> — items[] server price</div>
    <div>Webhook <span class="mono text-teal-300">POST /v1/pay/webhook/:apiId</span> HMAC</div>
    <div>Attach PSP <span class="mono text-teal-300">PUT /v1/pay/psp</span></div>
    <div class="text-slate-500 mt-2">Device push 501. Backup/snapshots off. Ledger TTL exempt.</div>
  </div>`;
}

async function queryPage(el) {
  el.innerHTML = `<div class="card p-4 max-w-xl space-y-2">
    <div class="k">Visual query builder — no SQL</div>
    <input id="q-col" class="w-full bg-[#12151c] border border-white/10 rounded-lg px-3 py-2 text-sm" placeholder="collection (images)" />
    <input id="q-field" class="w-full bg-[#12151c] border border-white/10 rounded-lg px-3 py-2 text-sm" placeholder="field (mime_type)" />
    <select id="q-op" class="w-full bg-[#12151c] border border-white/10 rounded-lg px-3 py-2 text-sm"><option>eq</option><option>contains</option><option>gt</option><option>lt</option></select>
    <input id="q-val" class="w-full bg-[#12151c] border border-white/10 rounded-lg px-3 py-2 text-sm" placeholder="value" />
    <button id="q-run" class="px-3 py-2 bg-teal-500 text-black rounded-lg text-sm font-semibold">Run query</button>
    <pre id="q-out" class="text-xs overflow-auto"></pre>
  </div>`;
  document.getElementById('q-run').onclick = async () => {
    const body = { collection: document.getElementById('q-col').value || undefined, where: [] };
    const field = document.getElementById('q-field').value;
    if (field) body.where.push({ field, op: document.getElementById('q-op').value, value: document.getElementById('q-val').value });
    document.getElementById('q-out').textContent = JSON.stringify({
      note: 'Admin preview of objects. Tenant query is POST /v1/query with an API key — this list is real GitHub metadata.',
      objects: await api('/objects'),
    }, null, 2);
  };
}

async function repos(el) {
  const d = await api('/overview');
  el.innerHTML = `<div class="grid md:grid-cols-2 gap-3">${(d.repos||[]).map(r=>`<div class="card p-4">
    <div class="flex justify-between"><div class="font-medium">${r.name}</div><span class="text-xs text-teal-300">${r.role}</span></div>
    <div class="text-xs text-slate-500 mt-2">${r.size_kb||0} KB · ${r.last_commit||'n/a'}</div>
    ${r.url?`<a class="text-xs text-teal-300" href="${r.url}" target="_blank">Open GitHub</a>`:''}
  </div>`).join('')}</div>`;
}

async function recycle(el) {
  const d = await api('/objects');
  const trash = (d.items||[]).filter(o => o.status === 'trash' || o.status === 'deleted');
  el.innerHTML = `<div class="text-sm text-slate-400 mb-3">Trash 15 din ke baad purge. orders/payments/pay_events exempt. Backup zip off.</div>` + (trash.length ? trash.map(o=>`<div class="card p-3 mb-2 flex justify-between"><div class="mono text-xs">${o.object_id}</div><button data-id="${o.object_id}" class="res text-xs px-2 py-1 bg-[#12151c] rounded">Restore</button></div>`).join('') : empty('Recycle bin is empty.'));
  el.querySelectorAll('.res').forEach(b => b.onclick = async () => { await api('/objects/'+b.dataset.id+'/restore',{method:'POST'}); go('recycle'); });
}

async function security(el) {
  el.innerHTML = `<div class="grid md:grid-cols-3 gap-3">
    ${card('Isolation','API-bound','cross-API GET returns 404')}
    ${card('Keys','hashed','gdb_live_ shown once')}
    ${card('Token','server-only','never in UI')}
  </div>`;
}

async function performance(el) {
  const m = await fetch('/metrics').then(r=>r.json());
  el.innerHTML = `<div class="grid md:grid-cols-3 gap-3">${card('Uptime', m.uptime_s+'s')}${card('Write mode', m.write_mode||'NORMAL')}${card('Ready', String(m.ready))}</div>
    <pre class="card p-4 mt-4 text-xs">${JSON.stringify(m,null,2)}</pre>`;
}

async function consolePage(el) {
  el.innerHTML = `<div class="card p-4 bg-black"><div class="text-xs text-slate-500 mb-2">GitDB console — not SQL</div>
    <input id="cin" class="w-full bg-transparent border-b border-white/10 py-2 outline-none mono text-sm" placeholder="help" />
    <pre id="cout" class="mt-3 text-xs min-h-[160px] text-teal-200"></pre></div>`;
  document.getElementById('cin').onkeydown = async (ev) => {
    if (ev.key !== 'Enter') return;
    const cmd = ev.target.value.trim();
    const out = document.getElementById('cout');
    if (cmd === 'help') out.textContent = 'help apis health doctor policy';
    else if (cmd === 'apis') out.textContent = JSON.stringify(await api('/apis'), null, 2);
    else if (cmd === 'health') out.textContent = JSON.stringify(await api('/health-db'), null, 2);
    else if (cmd === 'doctor') out.textContent = JSON.stringify(await api('/doctor'), null, 2);
    else if (cmd === 'policy') out.textContent = JSON.stringify(await api('/policy'), null, 2);
    else if (cmd === 'snapshot') out.textContent = 'Disabled. No snapshot history.';
    else out.textContent = 'unknown';
  };
}

async function playground(el) {
  el.innerHTML = `<div class="grid lg:grid-cols-2 gap-4">
    <div class="card p-4 space-y-2">
      <input id="pk" class="w-full bg-[#12151c] border border-white/10 rounded-lg px-3 py-2 text-sm" placeholder="gdb_live_..." />
      <div class="flex gap-2"><select id="pm" class="bg-[#12151c] border border-white/10 rounded-lg px-2 text-sm"><option>GET</option><option>POST</option><option>HEAD</option><option>DELETE</option></select>
      <input id="pp" class="flex-1 bg-[#12151c] border border-white/10 rounded-lg px-3 py-2 text-sm" value="/v1/data/bookings" /></div>
      <textarea id="pb" class="w-full h-32 bg-[#12151c] border border-white/10 rounded-lg px-3 py-2 text-sm" placeholder='{"filename":"note.txt","content":"hello","collection":"notes"}'></textarea>
      <button id="ps" class="px-3 py-2 bg-teal-500 text-black rounded-lg text-sm font-semibold">Send</button>
    </div>
    <pre id="po" class="card p-4 text-xs overflow-auto min-h-[240px]"></pre>
  </div>`;
  document.getElementById('ps').onclick = async () => {
    const t0 = performance.now();
    const res = await fetch(document.getElementById('pp').value, {
      method: document.getElementById('pm').value,
      headers: { Authorization: 'Bearer ' + document.getElementById('pk').value, 'Content-Type': 'application/json' },
      body: ['POST','PUT','PATCH'].includes(document.getElementById('pm').value) ? document.getElementById('pb').value : undefined
    });
    const text = await res.text();
    document.getElementById('po').textContent = res.status + ' · ' + Math.round(performance.now()-t0) + 'ms\n' + text;
  };
}

async function doctor(el) {
  const d = await api('/doctor');
  el.innerHTML = `<div class="card p-4 mb-3">Engine ${d.engine} ${d.version||''} · checked ${d.checked_at||''} · ${d.cached?'cached real probe':'fresh probe'}</div>` +
    d.checks.map(c => `<div class="card p-3 mb-2 flex justify-between"><span>${c.name}</span><span class="${c.result==='PASS'?'text-teal-300':'text-red-300'}">${c.result}</span></div>`).join('');
}

async function settings(el) {
  const h = await api('/policy');
  el.innerHTML = `<div class="card p-4 text-sm space-y-2">
    <div>Version: ${h.version}</div>
    <div>Database (only one): <span class="mono">${h.database_repo}</span></div>
    <div>Live storage repos: ${h.data_repos}</div>
    <div>Recycle: ${h.recycle_days} days then permanent delete</div>
    <div>Upload limit: ${Math.round(h.max_file_size/1024/1024)} MB</div>
    <div>Backup: ${h.backup_policy || 'disabled'}</div>
    <button id="sweep" class="mt-3 px-3 py-2 bg-[#12151c] border border-white/10 rounded-lg text-sm">Sweep recycle now</button>
  </div>`;
  document.getElementById('sweep').onclick = async () => { const r = await api('/recycle/sweep',{method:'POST'}); toast('Purged '+r.purged); };
}
