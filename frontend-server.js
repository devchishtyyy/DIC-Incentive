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

/**
 * A request for a built asset, as opposed to a page.
 *
 * The distinction matters because the two deserve opposite treatment when the file is
 * missing: a page should fall back to the app, an asset must not. Serving index.html for
 * a `.js` request returns HTML with a 200, the browser refuses to execute it, and the
 * result is a blank page with a MIME error — which reads like a routing fault and is not.
 */
function looksLikeAsset(urlPath) {
  return /\.[a-z0-9]+$/i.test(urlPath.split('?')[0])
}

/**
 * The same request, resolved as if the app were mounted at the site root.
 *
 * The frontend is built with `base: './'`, so the page asks for its assets relative to
 * wherever it is being served from. Mounted at the root of a site that is fine; mounted
 * under a path — which it must be, since another app already holds the root — every
 * request arrives as `/whatever/assets/index-abc.js` and there is no such file.
 *
 * Rather than making the server know its own mount path (which IIS does not tell it),
 * anything containing `/assets/` is retried from `dist/assets/` onwards. One directory,
 * fingerprinted filenames, so there is nothing to collide with.
 */
function resolveAssetAnyDepth(urlPath) {
  const at = urlPath.indexOf('/assets/')
  if (at < 0) return null
  return resolveInsideDist(urlPath.slice(at))
}

const handler = (request, response) => {
  void (async () => {
    const urlPath = request.url ?? '/'
    let file = resolveInsideDist(urlPath)

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

    // Mounted under a path: find the asset regardless of what prefix IIS passed through.
    if (!stat?.isFile()) {
      const anyDepth = resolveAssetAnyDepth(urlPath)
      if (anyDepth) {
        const found = await fsp.stat(anyDepth).catch(() => null)
        if (found?.isFile()) {
          file = anyDepth
          stat = found
        }
      }
    }

    /*
     * A missing asset is a 404 and says so. Only a page falls back to the app — the hash
     * router means that rarely arises, but a pasted deep link should land on the app.
     */
    if (!stat?.isFile()) {
      if (looksLikeAsset(urlPath)) {
        response.statusCode = 404
        response.setHeader('Content-Type', 'text/plain; charset=utf-8')
        response.end(`Not found: ${urlPath}`)
        return
      }

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
}

function announce() {
  const built = fs.existsSync(path.join(DIST, 'index.html'))
  console.log(
    `\n  DIC Production Incentive — frontend` +
      `\n  Listening → ${bound.join("  ")}` +
      `\n  Serving   → ${DIST} ${built ? '' : '(NOT BUILT — run `npm run build`)'}\n`,
  )
}

/**
 * Both loopback addresses, not just one.
 *
 * On Windows `localhost` resolves to `::1` before `127.0.0.1`, and IIS/ARR does not fall
 * back to the other family the way a browser or curl does. A server bound only to
 * `127.0.0.1` therefore looks dead to a rewrite rule that says `http://localhost:PORT` —
 * ARR reports 502.3 and nothing in this app's log explains it, because nothing ever
 * arrived. Binding both answers whichever `localhost` means while keeping the port off
 * the network. Set HOST to pin it to one address.
 */
const HOSTS = process.env.HOST ? [process.env.HOST] : ['127.0.0.1', '::1']
const servers = HOSTS.map(() => http.createServer(handler))
let pending = servers.length
const bound = []

servers.forEach((server, index) => {
  const address = HOSTS[index]

  server.on('error', (error) => {
    const code = error.code
    if (code === 'EADDRINUSE') {
      console.error(`\n  Port ${PORT} is already in use. Find what holds it: netstat -ano | findstr :${PORT}\n`)
      process.exit(1)
    }
    // A host with IPv6 switched off cannot bind ::1, which is not a failure on its own.
    if (address === '::1' && (code === 'EAFNOSUPPORT' || code === 'EADDRNOTAVAIL' || code === 'EINVAL')) {
      if (--pending === 0 && bound.length === 0) process.exit(1)
      return
    }
    console.error(`\n  Failed to listen on ${address}:${PORT} — ${String(error)}\n`)
    process.exit(1)
  })

  server.listen(PORT, address, () => {
    bound.push(address === '::1' ? `http://[::1]:${PORT}` : `http://${address}:${PORT}`)
    if (--pending === 0) announce()
  })
})

const closeAll = () => {
  let left = servers.length
  for (const server of servers) server.close(() => { if (--left === 0) process.exit(0) })
  setTimeout(() => process.exit(0), 5000).unref()
}

// PM2 on Windows asks a process to quit by sending a message, not a signal.
process.on('message', (message) => {
  if (message === 'shutdown') closeAll()
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => closeAll())
}
