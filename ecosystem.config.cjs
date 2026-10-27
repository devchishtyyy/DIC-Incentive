/**
 * PM2 config for the DIC Production Incentive app.
 *
 *   npm run deploy            <- REQUIRED FIRST. Builds backend/server.js and dist/.
 *   pm2 start ecosystem.config.cjs
 *
 * Neither script below is committed: `backend/server.js` is bundled from
 * `server/backend.ts` and `dist/` is the built frontend. A clone has neither, so
 * `pm2 start` straight after a `git pull` fails with "Script not found" — build first,
 * every time.
 *
 * Two apps, matching the pattern already running on this server. The asset-disposal app
 * holds 6002/6003, so this one takes the next pair: backend 6004, frontend 6005. Both
 * numbers also appear in web.config — change them together.
 *
 * `backend/server.js` is produced by `npm run build`; the source is `server/backend.ts`.
 */

module.exports = {
  apps: [
    {
      name: 'dic-incentive-backend',
      script: './backend/server.js',
      cwd: __dirname,
      env: {
        NODE_ENV: 'production',
        PORT: 6004,
      },
      env_development: {
        NODE_ENV: 'development',
        PORT: 6004,
      },
    },
    {
      name: 'dic-incentive-frontend',
      script: './frontend-server.js',
      cwd: __dirname,
      env: {
        NODE_ENV: 'production',
        PORT: 6005,
        DIST_PATH: './dist',
      },
      env_development: {
        NODE_ENV: 'development',
        PORT: 6005,
        DIST_PATH: './dist',
      },
    },
  ],
}
