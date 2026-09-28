try { require('dotenv').config(); } catch (e) { /* optional */ }

function required(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

const dataRepos = (process.env.GITHUB_DATA_REPOS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const accountTokens = {};
(process.env.GITHUB_ACCOUNT_TOKENS || '').split(',').forEach((pair) => {
  const idx = pair.indexOf(':');
  if (idx <= 0) return;
  const owner = pair.slice(0, idx).trim();
  const token = pair.slice(idx + 1).trim();
  if (owner && token) accountTokens[owner] = token;
});

module.exports = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  githubToken: process.env.GITHUB_TOKEN || '',
  accountTokens,
  owner: process.env.GITHUB_OWNER || 'husdainshah2-web',
  databaseRepo: process.env.GITHUB_DATABASE_REPO || 'ghs-database',
  dataRepos: dataRepos.length ? dataRepos : [
    'husdainshah2-web/ghs-data-01','husdainshah2-web/ghs-data-02','husdainshah2-web/ghs-data-03',
    'husdainshah2-web/ghs-data-04','husdainshah2-web/ghs-data-05','husdainshah2-web/ghs-data-06',
    'husdainshah2-web/ghs-data-07','husdainshah2-web/ghs-data-08','husdainshah2-web/ghs-data-09',
  ],
  adminUser: process.env.ADMIN_USERNAME || 'admin',
  adminPassword: process.env.ADMIN_PASSWORD || 'admin123',
  jwtSecret: process.env.JWT_SECRET || 'dev-jwt-secret-change-me',
  maxFileSize: parseInt(process.env.MAX_FILE_SIZE || `${50 * 1024 * 1024}`, 10),
  hardGithubLimit: 100 * 1024 * 1024,
  rateLimitPerMinute: parseInt(process.env.RATE_LIMIT_PER_MINUTE || '60', 10),
  uploadsPerMinute: parseInt(process.env.UPLOADS_PER_MINUTE || '20', 10),
  branch: 'main',
};
