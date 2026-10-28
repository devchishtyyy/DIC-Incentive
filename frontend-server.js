/**
 * Serves the built frontend.
 *
 * Plain Node, no dependencies: it hands out the files in `dist/` and nothing else. IIS
 * sends `/api/*` to the backend on its own port, so nothing here needs to know about it.
 *
 *   PORT       the port to listen on (default 6008; must match web.config)
 *   DIST_PATH  where the build is   (default ./dist)
 */

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'

const PORT = Number(process.env.PORT) || 6008
/** Loopback only: IIS is the only thing that should reach this. */
const HOST = process.env.HOST || '127.0.0.1'
const DIST = path.resolve(process.cwd(), process.env.DIST_PATH || './dist')

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
}

/**
 * Resolves a URL to a file inside `dist/`, and refuses anything that climbs out.
 *
 * `/../../.env.local` is the request this stops — the credentials file sits one level up
 * from the build. Resolving first and then checking the result is still under the root is
 * the only version of the check that holds, because the path could arrive encoded any
 * number of ways.
 */
function resolveInsideDist(urlPath) {
  let decoded
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0])
  } catch {
    return null
  }

  const resolved = path.resolve(DIST, `.${decoded}`)
  if (resolved !== DIST && !resolved.startsWith(DIST + path.sep)) return null
  return resolved
}

const server = http.createServer((request, response) => {
  void (async () => {
    let file = resolveInsideDist(request.url ?? '/')

    if (file === null) {
      response.statusCode = 403
      response.end('Forbidden')
      return
    }

    let stat = await fsp.stat(file).catch(() => null)
    if (stat?.isDirectory()) {
      file = path.join(file, 'index.html')
      stat = await fsp.stat(file).catch(() => null)
    }

    // Anything that is not a file falls back to index.html. The app uses hash routing so
    // this rarely arises, but a pasted deep link should land on the app, not a 404.
    if (!stat?.isFile()) {
      file = path.join(DIST, 'index.html')
      stat = await fsp.stat(file).catch(() => null)
      if (!stat?.isFile()) {
        response.statusCode = 404
        response.end('Not built. Run `npm run build` first.')
        return
      }
    }

    response.setHeader('Content-Type', MIME[path.extname(file).toLowerCase()] || 'application/octet-stream')
    response.setHeader('X-Content-Type-Options', 'nosniff')

    // Vite fingerprints asset filenames, so those can be cached hard. index.html cannot
    // be, or a deploy would not reach anybody until they cleared their browser cache.
    response.setHeader(
      'Cache-Control',
      file.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable',
    )

    fs.createReadStream(file).pipe(response)
  })().catch((error) => {
    console.error(`  Error serving ${request.url}: ${String(error)}`)
    if (!response.headersSent) {
      response.statusCode = 500
      response.end('Internal error.')
    }
  })
})

server.listen(PORT, HOST, () => {
  const built = fs.existsSync(path.join(DIST, 'index.html'))
  console.log(
    `\n  DIC Production Incentive — frontend` +
      `\n  Listening → http://${HOST}:${PORT}` +
      `\n  Serving   → ${DIST} ${built ? '' : '(NOT BUILT — run `npm run build`)'}\n`,
  )
})

// PM2 on Windows asks a process to quit by sending a message, not a signal.
process.on('message', (message) => {
  if (message === 'shutdown') server.close(() => process.exit(0))
})
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)))
}
