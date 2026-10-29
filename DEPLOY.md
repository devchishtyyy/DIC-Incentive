# Running it on the server

The app is **one process on one port**. It serves the built page and answers `/api/*`
itself, which is why both rewrite rules in `web.config` point at the same port.

```
browser → IIS (443) → web.config rewrite → localhost:6007 (API) + localhost:6008 (frontend)
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
git pull
npm install
pm2 start ecosystem.config.cjs
pm2 save
```

**No build step.** `dist/` and `backend/server.js` are committed, so a pull gives a tree
PM2 can start, the same way the other apps on this box are arranged.

| App | Script | Port |
|---|---|---|
| `dic-incentive-backend` | `./backend/server.js` | 6007 |
| `dic-incentive-frontend` | `./frontend-server.js` | 6008 |

After a pull, if PM2 is already running:

```powershell
pm2 restart dic-incentive-backend dic-incentive-frontend
```

The frontend **also forwards `/api/*` to the backend**, at any depth. IIS splitting the
traffic is therefore an optimisation, not a requirement: if the API rule does not fire -
which it will not when the app is mounted under a path, because `^api/(.*)` does not match
`dic/api/health` - the request still reaches the backend.

On a development machine, `npm run dev` is unchanged and `npm run build` regenerates both
committed artifacts. Build before committing so what ships matches the source.

## Checking it

```powershell
curl.exe http://127.0.0.1:6007/api/health        # backend  — JSON
curl.exe http://127.0.0.1:6008/                  # frontend — HTML
```

Through IIS, `/api/health` should return JSON. If it returns HTML, the Frontend rule is
catching it before the API rule — check the rule order.

## Changing the ports

6007 and 6008 appear in `ecosystem.config.cjs` and in `web.config`. Change them together
or the proxy forwards to nothing.

6002/6003 belong to the asset-disposal app and 6004/6005 were taken too, which is why
this one sits on 6007/6008.

## Worth knowing

- **Bound to `127.0.0.1`.** Only IIS can reach it, which is deliberate: the app's access
  control runs in the browser, so an open port would be an unauthenticated API.
- **Data is in each person's browser**, not on the server — see
  [SECURITY.md](SECURITY.md). Two people do not share a view, and clearing browser data
  loses that person's entries. Moving the state onto the server is the next real step.
- **The sign-in throttle counts the real client**, read from `X-Forwarded-For`, which ARR
  sets by default — nothing extra is needed in `web.config`. The header is trusted only on
  a loopback connection, which is the only way a request can arrive, since both servers
  bind `127.0.0.1`.
