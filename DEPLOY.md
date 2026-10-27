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
pm2 start ecosystem.config.cjs
pm2 save
```

`pm2 save` writes the process list so it comes back after a reboot — on Windows that also
needs `pm2-installer` or a scheduled task, since PM2 has no native Windows startup hook.

After a `git pull`:

```powershell
npm install
pm2 restart dic-incentive
```

PM2 runs `server/serve.mjs` rather than `npm run dev`. Both start the same server on the
same port; the wrapper exists only so the process **stops** properly. PM2 on Windows asks
a process to quit by sending it a `shutdown` message rather than a signal, and Vite's CLI
listens for neither — so `pm2 stop` reports success while the old server keeps hold of
6004, and the next start silently fails to bind. Verified here: the port was still
occupied after a stop until the wrapper was added.

## Checking it

```powershell
curl http://localhost:6004/api/sap/status    # should be JSON
curl http://localhost:6004/                  # should be HTML
```

If the first returns HTML, IIS is sending `/api/*` to the wrong place — check the API rule.

## Changing the port

`vite.config.ts` reads `DIC_PORT`; the default is 6004. Change it **and** both URLs in
`web.config` together. The app now refuses to start if the port is taken rather than
quietly moving to the next one, which behind a proxy would just look like the app being
down.

## Worth knowing

- **Bound to `127.0.0.1`.** Only IIS can reach it, which is deliberate: the app's access
  control runs in the browser, so an open port would be an unauthenticated API.
- **Data is in each person's browser**, not on the server — see
  [SECURITY.md](SECURITY.md). Two people do not share a view, and clearing browser data
  loses that person's entries. Moving the state onto the server is the next real step.
- **The sign-in throttle counts per caller.** `preserveHostHeader` in `web.config` passes
  the real client address through; without it every user shares one budget.
