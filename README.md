# GitHub Store

Custom object database. Persistent data lives only in GitHub repositories.

- Repos `ghs-data-01` … `ghs-data-09` = file storage
- Repo `ghs-database` = metadata / indexes / API registry / transactions
- Server = engine only (RAM cache, no SQLite / Postgres / Mongo)


## Multi-face API (still GitHub-only)

No SQLite / Firebase / Redis process is used. These routes store catalogs in repo 10:

- `PUT/GET /v1/schema/:collection` SQLite-like field rules
- `GET/PUT /v1/kv/:key` and `POST /v1/kv/:key/incr` Redis-like
- `POST /v1/query` Firebase-like where
- `POST /v1/sql` allowlisted `SELECT * FROM col WHERE field = value LIMIT n`
- `POST /v1/auth/smtp` save encrypted Gmail app password
- `POST /v1/auth/otp/start` + `/verify`
- `POST/GET /v1/notify` inbox, 15-day TTL


## API (client never talks to GitHub)

```
POST   /v1/objects              INSERT
GET    /v1/objects              LIST (own API only)
GET    /v1/objects/:id          GET metadata
GET    /v1/objects/:id/content  DOWNLOAD
PUT    /v1/objects/:id          REWRITE
PATCH  /v1/objects/:id          UPDATE
POST   /v1/objects/:id/rename   RENAME
DELETE /v1/objects/:id          logical DELETE
HEAD   /v1/objects/:id          EXISTS
```

Auth: `Authorization: Bearer <API_KEY>`

Admin dashboard: `/`  
Admin API: `/admin/api/*`

## Local

```bash
cp .env.example .env
# set GITHUB_TOKEN and repo names
npm install
npm test
npm start
```

## Notes

- Normal DELETE removes the live tree path and marks metadata `deleted`. Git history is not rewritten (history purge is separate).
- Concurrent writes retry on Git ref conflicts.
- Files over `MAX_FILE_SIZE` (default 50 MiB) are rejected. GitHub hard limit 100 MiB.
