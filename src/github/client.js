const config = require('../config');
const limits = require('../monitoring/githubLimits');

const BASE = 'https://api.github.com';

class GitHubError extends Error {
  constructor(status, body, method, url) {
    super(`GitHub ${status} ${method} ${url}: ${typeof body === 'string' ? body : JSON.stringify(body)}`);
    this.status = status;
    this.body = body;
  }
}

async function gh(method, path, body, extra = {}) {
  const url = path.startsWith('http') ? path : BASE + path;
  const headers = {
    Authorization: `Bearer ${config.githubToken}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'github-store-engine',
    ...(extra.headers || {}),
  };
  const opts = { method, headers };
  if (body !== undefined) {
    if (Buffer.isBuffer(body)) {
      opts.body = body;
    } else if (typeof body === 'string') {
      opts.body = body;
    } else {
      headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
  }
  const res = await fetch(url, opts);
  limits.capture(res);
  if (res.status === 403 && limits.state.remaining === 0) {
    const wait = Math.max(1, (limits.state.reset || 0) - Math.floor(Date.now() / 1000));
    const e = new Error('GITHUB_RATE_LIMIT');
    e.status = 429;
    e.code = 'GITHUB_RATE_LIMIT';
    e.retryAfter = wait;
    throw e;
  }
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  if (!res.ok) throw new GitHubError(res.status, json, method, path);
  return json;
}

function repoPath(repo) {
  return `/repos/${config.owner}/${repo}`;
}

async function getRef(repo, branch = config.branch) {
  return gh('GET', `${repoPath(repo)}/git/ref/heads/${branch}`);
}

async function getCommit(repo, sha) {
  return gh('GET', `${repoPath(repo)}/git/commits/${sha}`);
}

async function getTree(repo, sha, recursive = false) {
  const q = recursive ? '?recursive=1' : '';
  return gh('GET', `${repoPath(repo)}/git/trees/${sha}${q}`);
}

async function createBlob(repo, content, encoding = 'utf-8') {
  return gh('POST', `${repoPath(repo)}/git/blobs`, { content, encoding });
}

async function createTree(repo, tree, baseTree) {
  const payload = { tree };
  if (baseTree) payload.base_tree = baseTree;
  return gh('POST', `${repoPath(repo)}/git/trees`, payload);
}

async function createCommit(repo, message, treeSha, parents) {
  return gh('POST', `${repoPath(repo)}/git/commits`, {
    message,
    tree: treeSha,
    parents,
  });
}

async function updateRef(repo, sha, expectedSha, branch = config.branch) {
  try {
    return await gh('PATCH', `${repoPath(repo)}/git/refs/heads/${branch}`, {
      sha,
      force: false,
    });
  } catch (err) {
    if (err.status === 422 || err.status === 409) {
      const e = new Error('REF_CONFLICT');
      e.code = 'REF_CONFLICT';
      e.expectedSha = expectedSha;
      throw e;
    }
    throw err;
  }
}

async function getBlob(repo, sha) {
  return gh('GET', `${repoPath(repo)}/git/blobs/${sha}`);
}

async function getRepo(repo) {
  return gh('GET', repoPath(repo));
}

async function listCommits(repo, perPage = 1) {
  return gh('GET', `${repoPath(repo)}/commits?per_page=${perPage}`);
}

/**
 * Batch write/delete files using Git Database API (blobs/trees/commits/refs).
 * changes: [{ path, contentBase64 | contentUtf8, delete: true }]
 */
async function commitFiles(repo, message, changes, attempt = 0) {
  const ref = await getRef(repo);
  const parentSha = ref.object.sha;
  const commit = await getCommit(repo, parentSha);
  const baseTree = commit.tree.sha;

  const treeItems = [];
  for (const ch of changes) {
    if (ch.delete) {
      treeItems.push({
        path: ch.path,
        mode: '100644',
        type: 'blob',
        sha: null,
      });
      continue;
    }
    const encoding = ch.contentBase64 != null ? 'base64' : 'utf-8';
    const content = ch.contentBase64 != null ? ch.contentBase64 : ch.contentUtf8;
    const blob = await createBlob(repo, content, encoding);
    treeItems.push({
      path: ch.path,
      mode: '100644',
      type: 'blob',
      sha: blob.sha,
    });
  }

  const tree = await createTree(repo, treeItems, baseTree);
  const newCommit = await createCommit(repo, message, tree.sha, [parentSha]);
  try {
    await updateRef(repo, newCommit.sha, parentSha);
  } catch (err) {
    if (err.code === 'REF_CONFLICT' && attempt < 4) {
      await new Promise((r) => setTimeout(r, 150 * Math.pow(2, attempt)));
      return commitFiles(repo, message, changes, attempt + 1);
    }
    throw err;
  }
  return { commitSha: newCommit.sha, treeSha: tree.sha };
}

async function readFileUtf8(repo, path) {
  try {
    const data = await gh('GET', `${repoPath(repo)}/contents/${encodeURI(path)}?ref=${config.branch}`);
    if (Array.isArray(data)) return null;
    const buf = Buffer.from(data.content.replace(/\n/g, ''), 'base64');
    return { text: buf.toString('utf8'), sha: data.sha, size: data.size };
  } catch (err) {
    if (err.status === 404) return null;
    throw err;
  }
}

async function readFileBinary(repo, path) {
  try {
    const data = await gh('GET', `${repoPath(repo)}/contents/${encodeURI(path)}?ref=${config.branch}`);
    if (Array.isArray(data)) return null;
    const buf = Buffer.from(data.content.replace(/\n/g, ''), 'base64');
    return { buffer: buf, sha: data.sha, size: data.size };
  } catch (err) {
    if (err.status === 404) return null;
    throw err;
  }
}

module.exports = {
  GitHubError,
  gh,
  getRef,
  getCommit,
  getTree,
  createBlob,
  createTree,
  createCommit,
  updateRef,
  getBlob,
  getRepo,
  listCommits,
  commitFiles,
  readFileUtf8,
  readFileBinary,
  repoPath,
};
