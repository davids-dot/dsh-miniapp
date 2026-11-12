/**
 * miniapp fixed runtime entry.
 *
 * ONE Node process, ONE loopback port, ONE command: `node server.mjs`.
 * The supervisor injects PORT (and HOST) and nothing else. Vite runs in
 * middlewareMode and shares this very HTTP server for HMR, so the sandboxed
 * browser tab needs only one origin and one port.
 *
 * Backend helpers (all local, all node:sqlite — no second database):
 *   GET  /api/state?key=k        -> { value: <parsed JSON|null> }
 *   POST /api/state {key, value} -> { ok: true }
 *   POST /api/sql {sql, params?} -> { rows } | { changes, lastInsertRowid }
 * The same two endpoints are also served without the /api prefix.
 */
import { createServer } from 'node:http'
import { readFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { createServer as createViteServer } from 'vite'

const root = dirname(fileURLToPath(import.meta.url))
const port = Number(process.env.PORT || 5173)
const host = process.env.HOST || '127.0.0.1'

await mkdir(join(root, 'data'), { recursive: true })
const db = new DatabaseSync(join(root, 'data', 'app.db'))
db.exec('CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)')

function send(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    'cache-control': 'no-store',
  })
  res.end(text)
}

async function readBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > 256 * 1024) throw new Error('request body too large')
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('body must be a JSON object')
  }
  return parsed
}

/** Only single, side-effect-scoped statements. No ATTACH/DETACH/PRAGMA. */
const ALLOWED_SQL = /^\s*(SELECT|INSERT|UPDATE|DELETE|CREATE\s+(TABLE|INDEX|UNIQUE\s+INDEX)|DROP\s+(TABLE|INDEX))\b/i
const FORBIDDEN_SQL = /\b(ATTACH|DETACH|PRAGMA|VACUUM|REINDEX|LOAD_EXTENSION)\b/i

function runSql(sql, params) {
  if (typeof sql !== 'string' || sql.trim() === '') throw new Error('sql is required')
  const trimmed = sql.trim().replace(/;\s*$/, '')
  if (trimmed.includes(';')) throw new Error('only one statement is allowed')
  if (!ALLOWED_SQL.test(trimmed)) throw new Error('statement type is not allowed')
  if (FORBIDDEN_SQL.test(trimmed)) throw new Error('statement contains a forbidden operation')
  const args = Array.isArray(params) ? params : []
  if (args.some(v => v !== null && !['string', 'number', 'boolean', 'bigint'].includes(typeof v))) {
    throw new Error('params must be scalars')
  }
  const statement = db.prepare(trimmed)
  if (/^\s*SELECT\b/i.test(trimmed)) return { rows: statement.all(...args) }
  const result = statement.run(...args)
  return { changes: Number(result.changes), lastInsertRowid: Number(result.lastInsertRowid) }
}

async function handleApi(req, res, url) {
  const path = url.pathname.replace(/^\/api/, '')
  try {
    if (path === '/state' && req.method === 'GET') {
      const key = url.searchParams.get('key')
      if (!key) return send(res, 400, { error: 'key is required' })
      const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(key)
      return send(res, 200, { value: row ? JSON.parse(row.value) : null })
    }
    if (path === '/state' && req.method === 'POST') {
      const { key, value } = await readBody(req)
      if (typeof key !== 'string' || key === '') return send(res, 400, { error: 'key is required' })
      db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
        .run(key, JSON.stringify(value ?? null))
      return send(res, 200, { ok: true })
    }
    if (path === '/sql' && req.method === 'POST') {
      const { sql, params } = await readBody(req)
      return send(res, 200, runSql(sql, params))
    }
    return send(res, 404, { error: 'unknown endpoint' })
  } catch (error) {
    return send(res, 400, { error: error instanceof Error ? error.message : String(error) })
  }
}

let vite
const server = createServer((req, res) => {
  const url = new URL(req.url || '/', `http://${host}:${port}`)
  if (/^\/(api\/)?(state|sql)$/.test(url.pathname)) {
    void handleApi(req, res, url)
    return
  }
  if (!vite) {
    res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('starting')
    return
  }
  vite.middlewares(req, res, async () => {
    try {
      const html = await vite.transformIndexHtml(
        url.pathname,
        await readFile(join(root, 'index.html'), 'utf8'),
      )
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      })
      res.end(html)
    } catch (error) {
      vite.ssrFixStacktrace(error)
      console.error(error)
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('render failed')
    }
  })
})

vite = await createViteServer({
  root,
  configFile: join(root, 'vite.config.mjs'),
  appType: 'custom',
  server: {
    middlewareMode: true,
    hmr: { server },
    host,
  },
})

server.listen(port, host, () => {
  console.log(`[miniapp] ready http://${host}:${port}`)
})

function shutdown() {
  void Promise.allSettled([vite.close(), new Promise(resolve => server.close(resolve))])
    .then(() => { db.close(); process.exit(0) })
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
