const config = require('../config');
const git = require('../github/client');

const cache = {
  at: 0,
  repos: [],
  ttlMs: 5 * 60 * 1000,
  inflight: null,
};

function liteRepos() {
  const names = [`${config.owner}/${config.databaseRepo}`, ...config.dataRepos];
  return names.map((name) => ({
    name,
    role: String(name).includes('database') || name === config.databaseRepo ? 'database' : 'data',
    cached: true,
  }));
}

async function refreshRepos() {
  const names = [`${config.owner}/${config.databaseRepo}`, ...config.dataRepos];
  const out = [];
  const chunk = 12;
  for (let i = 0; i < names.length; i += chunk) {
    const slice = names.slice(i, i + chunk);
    const part = await Promise.all(slice.map(async (name) => {
      try {
        const info = await git.getRepo(name);
        return {
          name,
          private: info.private,
          size_kb: info.size,
          url: info.html_url,
          role: String(name).includes('ghs-database') || name === config.databaseRepo ? 'database' : 'data',
        };
      } catch (err) {
        return { name, error: 'unreachable', role: String(name).includes('database') ? 'database' : 'data' };
      }
    }));
    out.push(...part);
  }
  cache.at = Date.now();
  cache.repos = out;
  return out;
}

async function getRepos(force = false) {
  if (!force && cache.repos.length && Date.now() - cache.at < cache.ttlMs) return cache.repos;
  if (cache.inflight) return cache.inflight;
  cache.inflight = refreshRepos().finally(() => { cache.inflight = null; });
  return cache.inflight;
}

module.exports = { getRepos, liteRepos, cache };
