const crypto = require('crypto');
const config = require('../config');

function repoIndex(objectId) {
  const h = crypto.createHash('sha256').update(String(objectId)).digest();
  return h.readUInt32BE(0) % config.dataRepos.length;
}

function chooseRepo(objectId) {
  const i = repoIndex(objectId);
  return {
    repository_id: `repo_${String(i + 1).padStart(2, '0')}`,
    repo: config.dataRepos[i],
    index: i,
  };
}

function repoById(repositoryId) {
  const n = parseInt(String(repositoryId).replace('repo_', ''), 10);
  if (!n || n < 1 || n > config.dataRepos.length) return null;
  return {
    repository_id: `repo_${String(n).padStart(2, '0')}`,
    repo: config.dataRepos[n - 1],
    index: n - 1,
  };
}

module.exports = { chooseRepo, repoById, repoIndex };
