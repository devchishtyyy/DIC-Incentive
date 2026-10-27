# Security

Written for: whoever deploys and operates this app, and whoever signs off on it handling
real pay. Last reviewed 27 October 2026.

This is an honest account, not a reassurance. The second half matters more than the first.

---

## What is protected

### Credentials never reach the browser

The SuccessFactors signing key can mint an assertion for **any user in the tenant**. It
lives only in `.env.local` on the server, read as `SF_*` — never `VITE_SF_*`, because Vite
publishes anything with that prefix into the client bundle. The config refuses to read a
`VITE_SF_` variable and warns on startup if one is still set.

The browser calls `/api/sap/roster` and `/api/auth/login` on this app's own server; the
OAuth exchange and the Basic-auth check happen in Node.

Verified: `server/sapRoster.test.ts` asserts nothing under `src/` imports the server
modules, touches a key, or reads a `VITE_SF_` variable. A `dist/` grep finds no key, client
ID, company ID, username or tenant address.

### Passwords are not stored

A sign-in password lives in a React state field until the answer returns and in server
memory for one request. Not in `localStorage`, not in the audit trail, not in the server
log — only *failed usernames* are logged, so a locked-out person can be helped. Confirmed
by grepping the server log after signing in.

### Sign-in cannot be brute-forced, and cannot be used to attack SAP

`/api/auth/login` allows five failures per 15 minutes, counted against **both** the account
and the caller, then refuses for 15 minutes.

The refusal is decided locally, **before SuccessFactors is called**. That is the point: the
tenant has its own lockout policy, so an unthrottled app would let anyone lock real staff
out of SuccessFactors itself by hammering an employee number. The app would become the
instrument of a denial of service against the company's HR system.

Only a wrong credential counts against the budget — a tenant outage never locks anyone out.
The refusal message says nothing about whether an account exists.

### Authorisation is checked in one place

Every permission goes through `can()` / `canAny()`. No component checks a role name of its
own, so the matrix is the whole truth. A Super Admin viewing as another role changes only
what is permitted: writes stay stamped with their real user id, so the audit trail names
the person and never the costume.

### Other checks that passed

- **Dependencies:** 0 vulnerabilities. A HIGH Vite advisory (arbitrary command execution on
  Windows, GHSA-r825-w8mm-5pxw) was patched during this review — it mattered because the dev
  server is how this app actually runs.
- **XSS:** no `dangerouslySetInnerHTML`, `innerHTML`, `eval` or `new Function` anywhere.
  React escapes by default and nothing opts out.
- **Git history:** no private key, ever. Two findings were fixed during this review — the
  OAuth client ID was hard-coded as a default in `tools/fetch-sap-users.ps1`, and a real
  password fragment sat in a test assertion. Both now come from the environment or a
  neutral sentinel. **The client ID is still in the history of earlier commits.**
- **Network exposure:** the dev server binds localhost only. Do not add `--host` without
  reading the next section first.

---

## What is NOT protected

### The session is a line in localStorage — this is the big one

There is no server-side session. Signing in writes `{ userId }` to `localStorage`, and
every screen trusts it.

**Anyone who can open browser devtools on a machine where the app is loaded can set that
value to the Super Admin's account and have full access without a password.** The sign-in
is a front door with the ground-floor windows open.

The same applies to everything else, because all state is in `localStorage`:

- the audit log can be edited or emptied
- a locked period's frozen figures can be changed
- approved amounts and Earned values can be rewritten
- an employee can be added to the incentive list without MD approval

None of this is a bug to be patched. It follows from the app having no backend and no
database, which was the Phase 1 brief. **Every control in this app is a guard rail against
mistakes, not a defence against a determined person.**

### What that means in practice

This is safe for what it is now: a tool used by a handful of named people on their own
machines, where the risk is somebody clicking the wrong button, not somebody committing
fraud.

It is **not** safe as the system of record for pay. Before it is:

1. **Move the state to a server with a real database.** The browser must stop being the
   source of truth. `applyWrite` is already the only way state changes, so it ports to a
   server endpoint largely intact.
2. **Issue a real session.** A signed, expiring, httpOnly cookie from the login endpoint;
   the role resolved server-side on every request, never read from the client.
3. **Enforce permissions on the server.** `can()` is pure and has no browser dependency, so
   the same function runs in both places. Today the client is the only enforcement.
4. **Make the audit log append-only**, in a store the app itself cannot rewrite.
5. **Put the throttle in shared storage.** It is in memory today, so it resets on restart
   and would not hold across more than one server.
6. **Serve over HTTPS.** Passwords currently cross a plain HTTP hop to `localhost`, which
   is fine on one machine and not fine the moment `--host` is used.

---

## Things to do now

| | |
|---|---|
| **Rotate the SuccessFactors private key** | It was pasted into a chat transcript during development. Regenerate the OAuth client in Admin Center. |
| **Rotate the OAuth client ID** | Hard-coded in `tools/fetch-sap-users.ps1` in earlier commits. Regenerating the client covers both this and the key. |
| **Change the password of 10009671** | Used as a test credential during development and present in a transcript. |
| **Keep `.env.local` off any share** | It is gitignored, but OneDrive syncs the working folder. Check it is excluded. |

## Reporting

Found something? Tell the Super Admin account holder directly. Do not open a ticket that
quotes a credential.
