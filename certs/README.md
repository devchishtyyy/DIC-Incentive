# Corporate TLS certificates

Only needed if the SAP proxy fails with:

```
[vite] http proxy error: /oauth/idp
Error: self-signed certificate in certificate chain
```

## What that error means

Nothing is wrong with SAP, and nothing is wrong with the credentials. The Packages network
inspects outbound HTTPS: the firewall terminates the connection, reads it, and re-signs it
with an **internal root certificate authority**.

Chrome and Postman accept that because they read the **Windows certificate store**, where
IT has installed the corporate root. Node.js ships its own fixed list of public CAs and
ignores the Windows store, so the same connection fails for the dev server.

## The fix, which is already applied

`vite.config.ts` reads the Windows certificate store at startup (`tls.getCACertificates`,
Node 22.15+) and merges it with Node's own roots before handing them to the proxy. On
startup it prints how many it loaded:

```
  SAP proxy → https://api44.sapsf.com
  251 trusted CA certificates loaded (Node defaults + OS store).
```

**If the error has appeared, restart `npm run dev` first** — the bundle is built once at
startup, so a config change needs a fresh server.

## If it still fails

The corporate root may not be in the store this Node build reads. Export it and drop it
here.

1. In Chrome, open `https://api44.sapsf.com`, click the padlock → **Connection is secure**
   → **Certificate is valid**.
2. Go to the **Details** tab, select the **top** entry in the chain — the root, not the
   leaf for `*.sapsf.com`.
3. **Export…** → choose **Base-64 encoded X.509 (.CER)**.
4. Save it into this folder, for example `certs/packages-root.cer`.
5. Restart `npm run dev`.

Anything in here ending `.pem`, `.crt` or `.cer` is loaded automatically. This folder is
gitignored apart from this README — certificates are public, but they are specific to your
network and have no business in the repository.

`NODE_EXTRA_CA_CERTS` is honoured too, if you already have one set:

```powershell
$env:NODE_EXTRA_CA_CERTS = 'C:\path\to\corporate-root.pem'
npm run dev
```

## Last resort

If the certificate cannot be obtained, verification can be skipped for the single hop to
the SAP tenant. In `.env.local`:

```
SF_INSECURE_TLS=true
```

The dev server says so loudly on startup. This affects **only** the proxy's connection to
SuccessFactors from your machine, never the browser and never a build — but the connection
is already being inspected by the firewall, so turning this on means nothing is checking
who you are really talking to. Prefer the certificate.
