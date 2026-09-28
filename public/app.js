const API = '/admin/api';
let token = localStorage.getItem('adminToken');

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(API + path, { ...opts, headers });
  const data = await res.json();
  if (!res.ok || data.success === false) throw new Error((data.error && data.error.message) || 'Request failed');
  return data.data;
}

function showApp() {
  document.getElementById('login').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  load('overview');
}

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = document.getElementById('login-err');
  try {
    const data = await api('/login', {
      method: 'POST',
      body: JSON.stringify({
        username: document.getElementById('user').value,
        password: document.getElementById('pass').value,
      }),
    });
    token = data.token;
    localStorage.setItem('adminToken', token);
    showApp();
  } catch (ex) {
    err.textContent = ex.message;
    err.classList.remove('hidden');
  }
});

document.getElementById('logout').onclick = () => {
  localStorage.removeItem('adminToken');
  location.reload();
};

document.querySelectorAll('.nav').forEach((b) => {
  b.onclick = () => load(b.dataset.page);
});

if (token) showApp();

async function load(page) {
  document.getElementById('title').textContent = page[0].toUpperCase() + page.slice(1);
  const el = document.getElementById('content');
  el.textContent = 'Loading…';
  try {
    if (page === 'overview') {
      const d = await api('/overview');
      el.innerHTML = `
        <div class="grid md:grid-cols-3 gap-4 mb-6">
          <div class="bg-slate-900 border border-slate-800 rounded-xl p-4"><div class="text-slate-400 text-sm">APIs</div><div class="text-3xl font-bold">${d.apis}</div></div>
          <div class="bg-slate-900 border border-slate-800 rounded-xl p-4"><div class="text-slate-400 text-sm">Objects</div><div class="text-3xl font-bold">${d.objects}</div></div>
          <div class="bg-slate-900 border border-slate-800 rounded-xl p-4"><div class="text-slate-400 text-sm">Data repos</div><div class="text-3xl font-bold">${d.data_repos}</div></div>
        </div>
        <div class="text-slate-400 mb-2">Database repo: <b class="text-white">${d.database_repo}</b></div>
        <div class="space-y-2">${d.repos.map(r => `<div class="bg-slate-900 border border-slate-800 rounded-lg p-3 flex justify-between"><span>${r.name} <span class="text-xs text-emerald-400">${r.role}</span></span><span class="text-slate-400 text-sm">${r.size_kb || 0} KB</span></div>`).join('')}</div>`;
    }
    if (page === 'apis') {
      const list = await api('/apis');
      el.innerHTML = `
        <form id="new-api" class="flex gap-2 mb-4">
          <input name="name" placeholder="API name" class="px-3 py-2 bg-slate-800 rounded-lg flex-1" />
          <button class="px-4 py-2 bg-emerald-600 rounded-lg">Create API</button>
        </form>
        <div id="new-key" class="hidden mb-4 p-3 bg-amber-900/40 border border-amber-700 rounded-lg text-sm"></div>
        <div class="space-y-2">${list.map(a => `
          <div class="bg-slate-900 border border-slate-800 rounded-lg p-3 flex items-center justify-between">
            <div><div class="font-medium">${a.name}</div><div class="text-xs text-slate-400">${a.api_id} · ${a.status} · ${a.object_count || 0} objects</div></div>
            <div class="flex gap-2">
              <button data-act="toggle" data-id="${a.api_id}" data-status="${a.status}" class="text-xs px-2 py-1 bg-slate-700 rounded">${a.status === 'active' ? 'Disable' : 'Enable'}</button>
              <button data-act="rotate" data-id="${a.api_id}" class="text-xs px-2 py-1 bg-slate-700 rounded">Rotate key</button>
            </div>
          </div>`).join('') || '<div class="text-slate-500">No APIs yet</div>'}</div>`;
      document.getElementById('new-api').onsubmit = async (e) => {
        e.preventDefault();
        const name = e.target.name.value;
        const created = await api('/apis', { method: 'POST', body: JSON.stringify({ name }) });
        const box = document.getElementById('new-key');
        box.classList.remove('hidden');
        box.textContent = 'API key (save now): ' + created.api_key;
        load('apis');
      };
      el.querySelectorAll('[data-act]').forEach((b) => {
        b.onclick = async () => {
          if (b.dataset.act === 'toggle') {
            const path = b.dataset.status === 'active' ? '/disable' : '/enable';
            await api('/apis/' + b.dataset.id + path, { method: 'POST' });
          } else {
            const r = await api('/apis/' + b.dataset.id + '/rotate-key', { method: 'POST' });
            alert('New key: ' + r.api_key);
          }
          load('apis');
        };
      });
    }
    if (page === 'objects') {
      const d = await api('/objects');
      el.innerHTML = `<div class="space-y-2">${(d.items || []).map(o => `
        <div class="bg-slate-900 border border-slate-800 rounded-lg p-3">
          <div class="font-medium">${o.filename} <span class="text-xs text-slate-500">${o.object_id}</span></div>
          <div class="text-xs text-slate-400">${o.api_id} · ${o.repository_id} · ${o.size} B · ${o.status}</div>
        </div>`).join('') || '<div class="text-slate-500">No objects</div>'}</div>`;
    }
    if (page === 'repos') {
      const d = await api('/overview');
      el.innerHTML = d.repos.map(r => `
        <div class="bg-slate-900 border border-slate-800 rounded-xl p-4 mb-2">
          <div class="font-medium">${r.name}</div>
          <div class="text-sm text-slate-400">${r.role} · ${r.size_kb || 0} KB · last ${r.last_commit || 'n/a'}</div>
          ${r.url ? `<a class="text-sky-400 text-sm" href="${r.url}" target="_blank">Open on GitHub</a>` : ''}
        </div>`).join('');
    }
    if (page === 'database') {
      const d = await api('/health-db');
      el.innerHTML = `<pre class="bg-slate-900 border border-slate-800 rounded-xl p-4 text-sm overflow-auto">${JSON.stringify(d, null, 2)}</pre>
        <button id="rebuild" class="mt-4 px-4 py-2 bg-slate-700 rounded-lg">Rebuild index</button>`;
      document.getElementById('rebuild').onclick = async () => {
        await api('/rebuild-index', { method: 'POST' });
        load('database');
      };
    }
    if (page === 'doctor') {
      const d = await api('/doctor');
      el.innerHTML = `<div class="mb-3 text-slate-400">Engine ${d.engine} format ${d.format_version}</div>` +
        d.checks.map(c => `<div class="bg-slate-900 border border-slate-800 rounded-lg p-3 mb-2 flex justify-between"><span>${c.name}</span><span class="${c.result==='PASS'?'text-emerald-400':'text-red-400'}">${c.result}</span></div>`).join('');
    }
    if (page === 'playground') {
      el.innerHTML = `<div class="space-y-2 max-w-xl">
        <input id="pg-key" placeholder="API key gdb_live_..." class="w-full px-3 py-2 bg-slate-800 rounded-lg" />
        <select id="pg-method" class="w-full px-3 py-2 bg-slate-800 rounded-lg"><option>GET</option><option>POST</option><option>HEAD</option><option>DELETE</option></select>
        <input id="pg-path" value="/v1/objects" class="w-full px-3 py-2 bg-slate-800 rounded-lg" />
        <textarea id="pg-body" class="w-full h-28 px-3 py-2 bg-slate-800 rounded-lg" placeholder='{"filename":"note.txt","content":"hello"}'></textarea>
        <button id="pg-send" class="px-4 py-2 bg-emerald-600 rounded-lg">Send</button>
        <pre id="pg-out" class="text-xs bg-slate-900 border border-slate-800 rounded-lg p-3 overflow-auto"></pre>
      </div>`;
      document.getElementById('pg-send').onclick = async () => {
        const method = document.getElementById('pg-method').value;
        const path = document.getElementById('pg-path').value;
        const key = document.getElementById('pg-key').value;
        const body = document.getElementById('pg-body').value;
        const res = await fetch(path, {
          method,
          headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
          body: ['POST','PUT','PATCH'].includes(method) && body ? body : undefined,
        });
        const text = await res.text();
        document.getElementById('pg-out').textContent = res.status + '\n' + text;
      };
    }
    if (page === 'console') {
      el.innerHTML = `<p class="text-slate-400 text-sm mb-2">Commands: help · apis · health · doctor</p>
        <input id="con-in" class="w-full px-3 py-2 bg-slate-800 rounded-lg" placeholder="help" />
        <pre id="con-out" class="mt-3 text-sm bg-slate-900 border border-slate-800 rounded-lg p-3 min-h-[160px]"></pre>`;
      document.getElementById('con-in').onkeydown = async (ev) => {
        if (ev.key !== 'Enter') return;
        const cmd = ev.target.value.trim();
        const out = document.getElementById('con-out');
        if (cmd === 'help') out.textContent = 'help, apis, health, doctor';
        else if (cmd === 'apis') out.textContent = JSON.stringify(await api('/apis'), null, 2);
        else if (cmd === 'health') out.textContent = JSON.stringify(await api('/health-db'), null, 2);
        else if (cmd === 'doctor') out.textContent = JSON.stringify(await api('/doctor'), null, 2);
        else out.textContent = 'unknown command';
      };
    }
  } catch (ex) {
    el.innerHTML = `<div class="text-red-400">${ex.message}</div>`;
  }
}
