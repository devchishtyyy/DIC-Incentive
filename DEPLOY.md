# Running it on the server

The app is **one process on one port**. It serves the built page and answers `/api/*`
itself, which is why both rewrite rules in `web.config` point at the same port.

```
browser → IIS (443) → web.config rewrite → localhost:6004 → the app
```

## Once

```powershell
cd <the clone>
npm ci
```

Create `.env.local` from `.env.example` and fill in the `SF_*` values. It is gitignored and
must stay that way — it holds the SuccessFactors signing key.

Enable the IIS modules the rewrite needs — **URL Rewrite** and **Application Request
Routing** — then switch ARR's proxy on:

```powershell
%windir%\system32\inetsrv\appcmd.exe set config -section:system.webServer/proxy /enabled:"True" /commit:apphost
```

Put `web.config` in the site root. It is in this repo, so a `git pull` keeps it current.

## Running it

```powershell
npm run build
pm2 start ecosystem.config.cjs
pm2 save
```

Two apps, matching the asset-disposal pattern already on this server:

| App | Script | Port |
|---|---|---|
| `dic-incentive-backend` | `./backend/server.js` | 6004 |
| `dic-incentive-frontend` | `./frontend-server.js` | 6005 |

`backend/server.js` is **built**, not committed — `npm run build` bundles it from
`server/backend.ts`. So a `git pull` alone is not enough:

```powershell
git pull
npm install
npm run build
pm2 restart dic-incentive-backend dic-incentive-frontend
```

`pm2 save` writes the list so it survives a reboot; on Windows that also needs
`pm2-installer` or a scheduled task, since PM2 has no native Windows startup hook.

## Checking it

```powershell
curl http://localhost:6004/api/health        # backend  — JSON
curl http://localhost:6005/                  # frontend — HTML
```

Through IIS, `/api/health` should return JSON. If it returns HTML, the Frontend rule is
catching it before the API rule — check the rule order.

## Changing the ports

6004 and 6005 appear in `ecosystem.config.cjs` and in `web.config`. Change them together
or the proxy forwards to nothing.

## Worth knowing

- **Bound to `127.0.0.1`.** Only IIS can reach it, which is deliberate: the app's access
  control runs in the browser, so an open port would be an unauthenticated API.
- **Data is in each person's browser**, not on the server — see
  [SECURITY.md](SECURITY.md). Two people do not share a view, and clearing browser data
  loses that person's entries. Moving the state onto the server is the next real step.
- **The sign-in throttle counts per caller.** `preserveHostHeader` in `web.config` passes
  the real client address through; without it every user shares one budget.
