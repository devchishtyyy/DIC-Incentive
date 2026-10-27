/**
 * The app, started in a way PM2 can actually stop.
 *
 * Running `vite` straight from PM2 looks fine until the first restart. PM2 on Windows asks
 * a process to stop by sending it a `shutdown` **message**, not a signal — and Vite's CLI
 * listens for neither. So PM2 marks the app stopped, the dev server carries on holding the
 * port, and the replacement cannot bind: `pm2 restart` takes the site down and leaves it
 * down, with `pm2 ls` reporting everything is fine.
 *
 * Starting Vite through its API instead means there is something here to receive the
 * message and call `server.close()`. Same server, same config, same single port — the only
 * thing this adds is an exit that works.
 */

import { createServer } from 'vite'

const server = await createServer()
await server.listen()
server.printUrls()

let closing = false

async function shutdown(reason) {
  if (closing) return
  closing = true
  console.log(`\n  ${reason} — closing the server.`)

  // Give the close a moment, but never hang: a process that will not exit is worse than
  // one that exits abruptly, because PM2 will wait on it and the port stays held.
  const timer = setTimeout(() => {
    console.warn('  Close timed out; exiting anyway.')
    process.exit(0)
  }, 5000)

  try {
    await server.close()
  } catch (error) {
    console.error(`  Error while closing: ${String(error)}`)
  }

  clearTimeout(timer)
  process.exit(0)
}

// How PM2 asks on Windows.
process.on('message', (message) => {
  if (message === 'shutdown') void shutdown('shutdown message')
})

// How PM2 asks everywhere else, and how Ctrl+C asks.
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => void shutdown(signal))
}

// A crash should still release the port rather than leaving a zombie on it.
process.on('uncaughtException', (error) => {
  console.error(`  Uncaught: ${String(error)}`)
  void shutdown('uncaught exception')
})
