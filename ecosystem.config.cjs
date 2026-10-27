/**
 * PM2 config for the DIC Production Incentive app.
 *
 *   pm2 start ecosystem.config.cjs
 *
 * Runs `server/serve.mjs`, not `npm run dev` and not Vite's CLI. Both of those leave the
 * dev server alive on `pm2 stop` under Windows — PM2 reports the app stopped while the old
 * process keeps hold of port 6004, so the next start cannot bind and the site stays down
 * with `pm2 ls` insisting all is well. `serve.mjs` listens for the shutdown message PM2
 * actually sends and closes the server properly.
 *
 * `.cjs` because package.json has no "type" field but PM2 wants CommonJS, and the
 * extension says so unambiguously.
 */

const path = require('node:path')

module.exports = {
  apps: [
    {
      name: 'dic-incentive',
      script: path.join('server', 'serve.mjs'),
      cwd: __dirname,
      interpreter: 'node',

      // One instance. The app keeps no shared server state, and a second copy would only
      // fight the first for the port.
      instances: 1,
      exec_mode: 'fork',

      env: {
        // Vite's dev server; NODE_ENV=production would disable it.
        NODE_ENV: 'development',
        // Tells vite.config.ts not to open a browser — there is nobody at the server.
        DIC_SERVER: '1',
        // The port web.config forwards to. Change both together.
        DIC_PORT: '6004',
      },

      autorestart: true,
      // Vite reloads itself on file changes; PM2 watching as well would restart the
      // process under it and drop every open session for no reason.
      watch: false,

      // A crash loop should stop and stay stopped, so it is visible in `pm2 ls` rather
      // than quietly burning the CPU all weekend.
      max_restarts: 10,
      min_uptime: '30s',
      restart_delay: 5000,

      // Vite is comfortably under this; passing it means something has gone wrong.
      max_memory_restart: '1G',

      // Kill the whole tree, and allow time for the port to be released before PM2 gives
      // up and starts a replacement that cannot bind.
      treekill: true,
      kill_timeout: 8000,
      windowsHide: true,

      error_file: path.join(__dirname, 'logs', 'error.log'),
      out_file: path.join(__dirname, 'logs', 'out.log'),
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
  ],
}
