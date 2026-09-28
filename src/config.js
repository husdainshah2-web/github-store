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

module.exports = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  githubToken: process.env.GITHUB_TOKEN || '',
  owner: process.env.GITHUB_OWNER || 'husdainshah2-web',
  databaseRepo: process.env.GITHUB_DATABASE_REPO || 'ghs-database',
  dataRepos: dataRepos.length ? dataRepos : [
    'ghs-data-01','ghs-data-02','ghs-data-03','ghs-data-04','ghs-data-05',
    'ghs-data-06','ghs-data-07','ghs-data-08','ghs-data-09',
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
