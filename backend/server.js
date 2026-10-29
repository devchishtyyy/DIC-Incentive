// server/backend.ts
import fs from "node:fs";
import http from "node:http";
import https3 from "node:https";
import path from "node:path";
import tls from "node:tls";

// server/loginThrottle.ts
var DEFAULT_THROTTLE = {
  maxFailures: 5,
  windowMs: 15 * 60 * 1e3,
  lockoutMs: 15 * 60 * 1e3
};
var ALLOWED = { allowed: true, retryAfterSeconds: 0, message: "" };
var LoginThrottle = class {
  constructor(config = DEFAULT_THROTTLE) {
    this.config = config;
  }
  config;
  attempts = /* @__PURE__ */ new Map();
  /**
   * Whether this attempt may proceed. Checks every key — username and caller — and the
   * strictest answer wins.
   */
  check(keys, now = Date.now()) {
    let worst = ALLOWED;
    for (const key of keys) {
      const attempt = this.attempts.get(key);
      if (!attempt) continue;
      if (attempt.lockedUntil > now) {
        const seconds = Math.ceil((attempt.lockedUntil - now) / 1e3);
        if (seconds > worst.retryAfterSeconds) {
          worst = {
            allowed: false,
            retryAfterSeconds: seconds,
            // Deliberately says nothing about whether the username exists.
            message: `Too many sign-in attempts. Try again in ${Math.ceil(seconds / 60)} minute${seconds > 60 ? "s" : ""}.`
          };
        }
      }
    }
    return worst;
  }
  /** Records a failed attempt against every key, and shuts the gate if one goes over. */
  recordFailure(keys, now = Date.now()) {
    for (const key of keys) {
      const existing = this.attempts.get(key);
      const attempt = existing && now - existing.firstAt < this.config.windowMs ? existing : { failures: 0, firstAt: now, lockedUntil: 0 };
      attempt.failures += 1;
      if (attempt.failures >= this.config.maxFailures) {
        attempt.lockedUntil = now + this.config.lockoutMs;
      }
      this.attempts.set(key, attempt);
    }
  }
  /** A sign-in that worked clears the slate, so one typo does not haunt somebody all day. */
  recordSuccess(keys) {
    for (const key of keys) this.attempts.delete(key);
  }
  /** Drops entries nobody has touched in a while, so the map cannot grow without bound. */
  prune(now = Date.now()) {
    for (const [key, attempt] of this.attempts) {
      const stale = now - attempt.firstAt > this.config.windowMs && attempt.lockedUntil < now;
      if (stale) this.attempts.delete(key);
    }
  }
  /** For tests and diagnostics. */
  size() {
    return this.attempts.size;
  }
};
function throttleKeys(username, remoteAddress) {
  const bare = username.trim().toLowerCase().split("@")[0];
  const keys = [];
  if (bare) keys.push(`user:${bare}`);
  if (remoteAddress) keys.push(`addr:${remoteAddress}`);
  return keys;
}
function callerAddress(remoteAddress, forwardedFor) {
  const loopback = remoteAddress === "127.0.0.1" || remoteAddress === "::1" || remoteAddress === "::ffff:127.0.0.1";
  if (!loopback) return remoteAddress;
  const header = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
  if (!header) return remoteAddress;
  const client = header.split(",")[0]?.trim();
  return client || remoteAddress;
}

// server/sapAuth.ts
import https from "node:https";
import { URL } from "node:url";
var COMPANY_SUFFIX = "packagesli";
function qualifyUsername(raw, suffix = COMPANY_SUFFIX) {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  return trimmed.includes("@") ? trimmed : `${trimmed}@${suffix}`;
}
function authProbeUrl(apiServer) {
  const base = (apiServer || "https://api44.sapsf.com").replace(/\/+$/, "");
  return `${base}/odata/v2/Background_Community?$top=1&$format=json`;
}
function request(url, authorization, agent2) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const call = https.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || 443,
        path: `${target.pathname}${target.search}`,
        method: "GET",
        headers: { Authorization: authorization, Accept: "application/json" },
        agent: agent2
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
      }
    );
    call.on("error", reject);
    call.end();
  });
}
function looksLikeOData(body) {
  try {
    const parsed = JSON.parse(body);
    return typeof parsed === "object" && parsed !== null && "d" in parsed;
  } catch {
    return false;
  }
}
function outcomeFor(status, body) {
  if (status === 200) {
    return looksLikeOData(body) ? { outcome: "ok", message: "" } : {
      outcome: "unavailable",
      message: "SuccessFactors answered, but not with SAP data. Something on the network is intercepting the request."
    };
  }
  if (status === 401) return { outcome: "rejected", message: "That username or password is not right." };
  if (status === 403) {
    return {
      outcome: "forbidden",
      message: "Your sign-in is valid, but the account is not allowed to read the check used here. Ask IT about its API permission role."
    };
  }
  if (status >= 500) return { outcome: "unavailable", message: `SuccessFactors is not answering (HTTP ${status}). Try again shortly.` };
  return { outcome: "unavailable", message: `Unexpected reply from SuccessFactors (HTTP ${status}).` };
}
async function verifyCredentials(rawUsername, password, apiServer, agent2) {
  const username = qualifyUsername(rawUsername);
  if (!username || !password) {
    return { outcome: "rejected", username, message: "Enter both a username and a password." };
  }
  const authorization = `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`;
  let probe;
  try {
    probe = await request(authProbeUrl(apiServer), authorization, agent2);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const trust = /self[- ]signed|unable to verify|CERT_|certificate/i.test(detail);
    return {
      outcome: "unavailable",
      username,
      message: trust ? "Could not reach SuccessFactors: the network re-signs HTTPS with a certificate this server does not trust. See certs/README.md." : `Could not reach SuccessFactors. ${detail}`
    };
  }
  const { outcome, message } = outcomeFor(probe.status, probe.body);
  return { outcome, username, message };
}

// server/sapRoster.ts
import https2 from "node:https";
import { URL as URL2, URLSearchParams } from "node:url";
var SapError = class extends Error {
  constructor(message, stage, detail = "") {
    super(message);
    this.stage = stage;
    this.detail = detail;
    this.name = "SapError";
  }
  stage;
  detail;
};
function request2(url, init) {
  return new Promise((resolve, reject) => {
    const target = new URL2(url);
    const call = https2.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || 443,
        path: `${target.pathname}${target.search}`,
        method: init.method,
        headers: init.headers,
        agent: init.agent
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
      }
    );
    call.on("error", reject);
    if (init.body) call.write(init.body);
    call.end();
  });
}
function forDisplay(body) {
  const trimmed = body.trim();
  return trimmed.length > 600 ? `${trimmed.slice(0, 600)}\u2026` : trimmed;
}
function describeTransportError(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (/self[- ]signed|unable to verify|CERT_|certificate/i.test(message)) {
    return `${message} \u2014 your network re-signs HTTPS with an internal certificate authority. The dev server reads the Windows certificate store on startup; see certs/README.md if it still fails.`;
  }
  return message;
}
function baseUrl(credentials2) {
  return (credentials2.apiServer || "https://api44.sapsf.com").replace(/\/+$/, "");
}
function tokenUrlFor(credentials2) {
  return `${baseUrl(credentials2)}/oauth/token`;
}
function buildUserQuery(credentials2, range2) {
  const filter = `userId ge '${range2.fromUserId}' and userId le '${range2.toUserId}' and status eq 't'`;
  const params = new URLSearchParams({ $filter: filter, $format: "json" });
  return `${baseUrl(credentials2)}/odata/v2/User?${params.toString()}`;
}
function credentialsAreComplete(credentials2) {
  return Boolean(credentials2.clientId && credentials2.companyId && credentials2.userId && credentials2.privateKey);
}
async function requestAssertion(credentials2, agent2) {
  const body = new URLSearchParams({
    client_id: credentials2.clientId,
    user_id: credentials2.userId,
    token_url: tokenUrlFor(credentials2),
    private_key: credentials2.privateKey
  }).toString();
  let result;
  try {
    result = await request2(`${baseUrl(credentials2)}/oauth/idp`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": String(Buffer.byteLength(body)) },
      body,
      agent: agent2
    });
  } catch (error) {
    throw new SapError("Could not reach SuccessFactors.", "assertion", describeTransportError(error));
  }
  if (result.status < 200 || result.status >= 300) {
    throw new SapError(`SuccessFactors refused to sign the assertion (HTTP ${result.status}).`, "assertion", forDisplay(result.body));
  }
  if (!result.body.trim()) {
    throw new SapError("SuccessFactors returned an empty assertion.", "assertion", "Check the client ID and the private key.");
  }
  return result.body.trim();
}
async function requestToken(credentials2, assertion, agent2, now = Date.now()) {
  const body = new URLSearchParams({
    client_id: credentials2.clientId,
    company_id: credentials2.companyId,
    grant_type: "urn:ietf:params:oauth:grant-type:saml2-bearer",
    assertion
  }).toString();
  let result;
  try {
    result = await request2(`${baseUrl(credentials2)}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": String(Buffer.byteLength(body)) },
      body,
      agent: agent2
    });
  } catch (error) {
    throw new SapError("Could not reach the token endpoint.", "token", describeTransportError(error));
  }
  if (result.status < 200 || result.status >= 300) {
    throw new SapError(`The token exchange failed (HTTP ${result.status}).`, "token", forDisplay(result.body));
  }
  let parsed;
  try {
    parsed = JSON.parse(result.body);
  } catch {
    throw new SapError("The token response was not JSON.", "token", forDisplay(result.body));
  }
  if (!parsed.access_token) {
    throw new SapError(
      parsed.error_description || parsed.error || "No access token in the response.",
      "token",
      "The assertion is generated fresh each time, so a failure here usually means the company ID or the client ID is wrong."
    );
  }
  const seconds = Number(parsed.expires_in);
  const lifetime = Number.isFinite(seconds) && seconds > 0 ? seconds : 24 * 60 * 60;
  return { token: parsed.access_token, expiresAt: now + (lifetime - 60) * 1e3 };
}
async function fetchUsers(credentials2, token, range2, agent2, onProgress) {
  const users = [];
  let url = buildUserQuery(credentials2, range2);
  let pages = 0;
  while (url) {
    let result;
    try {
      result = await request2(url, { method: "GET", headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, agent: agent2 });
    } catch (error) {
      throw new SapError("Could not read the User entity.", "users", describeTransportError(error));
    }
    if (result.status < 200 || result.status >= 300) {
      throw new SapError(`Reading the User entity failed (HTTP ${result.status}).`, "users", forDisplay(result.body));
    }
    let full;
    try {
      full = JSON.parse(result.body);
    } catch {
      throw new SapError("The User response was not JSON.", "users", forDisplay(result.body));
    }
    users.push(...full.d?.results ?? []);
    pages += 1;
    onProgress?.({ stage: "users", message: `Read ${users.length} users over ${pages} page(s)\u2026`, count: users.length });
    url = full.d?.__next ?? null;
  }
  return users;
}
var cached = null;
function clearTokenCache() {
  cached = null;
}
async function accessToken(credentials2, agent2, onProgress) {
  if (cached && cached.expiresAt > Date.now()) return cached.token;
  onProgress?.({ stage: "assertion", message: "Asking SuccessFactors to sign a SAML assertion\u2026", count: 0 });
  const assertion = await requestAssertion(credentials2, agent2);
  onProgress?.({ stage: "token", message: "Exchanging the assertion for an access token\u2026", count: 0 });
  cached = await requestToken(credentials2, assertion, agent2);
  return cached.token;
}
async function fetchRoster(credentials2, range2, agent2, onProgress) {
  const token = await accessToken(credentials2, agent2, onProgress);
  onProgress?.({ stage: "users", message: "Reading the roster\u2026", count: 0 });
  let users;
  try {
    users = await fetchUsers(credentials2, token, range2, agent2, onProgress);
  } catch (error) {
    if (error instanceof SapError && error.stage === "users" && /HTTP 401|HTTP 403/.test(error.message)) {
      clearTokenCache();
      users = await fetchUsers(credentials2, await accessToken(credentials2, agent2, onProgress), range2, agent2, onProgress);
    } else {
      throw error;
    }
  }
  onProgress?.({ stage: "done", message: `Read ${users.length} users.`, count: users.length });
  return users;
}

// server/backend.ts
var PORT = Number(process.env.PORT) || 6007;
var HOST = process.env.HOST || "127.0.0.1";
var MAX_BODY = 4096;
function loadEnvFile() {
  const file = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const at = trimmed.indexOf("=");
    if (at < 1) continue;
    const key = trimmed.slice(0, at).trim();
    let value = trimmed.slice(at + 1).trim();
    if (value.startsWith('"') && value.endsWith('"') || value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === void 0) process.env[key] = value.replace(/\\n/g, "\n");
  }
}
function buildCaBundle() {
  const certificates = [];
  const getCACertificates = tls.getCACertificates;
  for (const source of ["default", "system"]) {
    try {
      const found = getCACertificates?.(source);
      if (Array.isArray(found)) certificates.push(...found);
    } catch {
    }
  }
  const extra = process.env.NODE_EXTRA_CA_CERTS;
  if (extra && fs.existsSync(extra)) {
    try {
      certificates.push(fs.readFileSync(extra, "utf8"));
    } catch {
    }
  }
  const certsDir = path.resolve(process.cwd(), "certs");
  if (fs.existsSync(certsDir)) {
    for (const file of fs.readdirSync(certsDir)) {
      if (!/\.(pem|crt|cer)$/i.test(file)) continue;
      try {
        certificates.push(fs.readFileSync(path.join(certsDir, file), "utf8"));
      } catch {
      }
    }
  }
  return certificates;
}
loadEnvFile();
var credentials = {
  apiServer: process.env.SF_API_SERVER || "https://api44.sapsf.com",
  clientId: process.env.SF_CLIENT_ID || "",
  companyId: process.env.SF_COMPANY_ID || "",
  userId: process.env.SF_USER_ID || "",
  privateKey: process.env.SF_PRIVATE_KEY || ""
};
var range = {
  fromUserId: process.env.SF_FROM_USER_ID || "40000000",
  toUserId: process.env.SF_TO_USER_ID || "40009999"
};
var insecureTls = process.env.SF_INSECURE_TLS === "true";
var caBundle = buildCaBundle();
var agent = insecureTls ? new https3.Agent({ rejectUnauthorized: false, keepAlive: true }) : new https3.Agent({ ca: caBundle.length > 0 ? caBundle : void 0, keepAlive: true });
var configured = credentialsAreComplete(credentials);
var throttle = new LoginThrottle();
var inFlight = null;
function send(response, status, payload) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.end(JSON.stringify(payload));
}
function readBody(request3, limit) {
  return new Promise((resolve, reject) => {
    let body = "";
    request3.on("data", (chunk) => {
      body += chunk.toString("utf8");
      if (body.length > limit) reject(new Error("Request too large"));
    });
    request3.on("end", () => resolve(body));
    request3.on("error", reject);
  });
}
var handler = (request3, response) => {
  const route = (request3.url ?? "/").split("?")[0].replace(/\/$/, "") || "/";
  const method = request3.method ?? "GET";
  void (async () => {
    switch (route) {
      case "/api/health":
        send(response, 200, { ok: true, service: "dic-incentive-backend", at: (/* @__PURE__ */ new Date()).toISOString() });
        return;
      case "/api/sap/status":
        send(response, 200, {
          configured,
          signInAvailable: true,
          apiServer: credentials.apiServer,
          range,
          reason: configured ? "" : "SAP credentials are not configured on the server. Set SF_* in .env.local and restart."
        });
        return;
      case "/api/auth/login": {
        if (method !== "POST") {
          send(response, 405, { ok: false, outcome: "unavailable", message: "POST only." });
          return;
        }
        let parsed;
        try {
          parsed = JSON.parse(await readBody(request3, MAX_BODY) || "{}");
        } catch {
          send(response, 400, { ok: false, outcome: "rejected", message: "Sign-in request was not readable." });
          return;
        }
        const username = parsed.username ?? "";
        const keys = throttleKeys(username, callerAddress(request3.socket?.remoteAddress, request3.headers["x-forwarded-for"]));
        throttle.prune();
        const verdict = throttle.check(keys);
        if (!verdict.allowed) {
          console.warn(`  Sign-in throttled for ${keys.join(" ")} \u2014 ${verdict.retryAfterSeconds}s remaining`);
          response.setHeader("Retry-After", String(verdict.retryAfterSeconds));
          send(response, 429, { ok: false, outcome: "rejected", message: verdict.message });
          return;
        }
        const result = await verifyCredentials(username, parsed.password ?? "", credentials.apiServer, agent);
        if (result.outcome !== "ok") {
          if (result.outcome === "rejected") throttle.recordFailure(keys);
          console.log(`  Sign-in ${result.outcome} for ${result.username || "(no username)"}`);
          send(response, result.outcome === "rejected" ? 401 : 502, {
            ok: false,
            outcome: result.outcome,
            message: result.message
          });
          return;
        }
        throttle.recordSuccess(keys);
        send(response, 200, { ok: true, username: result.username });
        return;
      }
      case "/api/sap/roster": {
        if (!configured) {
          send(response, 503, {
            ok: false,
            stage: "assertion",
            message: "SAP credentials are not configured on the server.",
            detail: "Set SF_CLIENT_ID, SF_COMPANY_ID, SF_USER_ID and SF_PRIVATE_KEY in .env.local, then restart."
          });
          return;
        }
        try {
          if (!inFlight) {
            inFlight = fetchRoster(credentials, range, agent, (progress) => {
              if (progress.stage !== "users" || progress.count % 500 === 0) {
                console.log(`  SAP sync: ${progress.message}`);
              }
            }).finally(() => {
              inFlight = null;
            });
          }
          send(response, 200, { ok: true, users: await inFlight });
        } catch (error) {
          const stage = error instanceof SapError ? error.stage : "assertion";
          const message = error instanceof Error ? error.message : String(error);
          const detail = error instanceof SapError ? error.detail : "";
          console.error(`
  SAP sync failed at the ${stage} step: ${message}
  ${detail}
`);
          send(response, 502, { ok: false, stage, message, detail });
        }
        return;
      }
      default:
        send(response, 404, { ok: false, message: `No such endpoint: ${route}` });
    }
  })().catch((error) => {
    console.error(`  Error handling ${route}: ${String(error)}`);
    if (!response.headersSent) send(response, 500, { ok: false, message: "Internal error." });
  });
};
function announce() {
  console.log(
    `
  DIC Production Incentive \u2014 API
  Listening \u2192 ${bound.join("  ")}/api
  SAP       \u2192 ${credentials.apiServer} ${configured ? "(configured)" : "(NOT configured \u2014 sync unavailable)"}
  TLS       \u2192 ${insecureTls ? "VERIFICATION DISABLED by SF_INSECURE_TLS" : `${caBundle.length} trusted CA certificates`}
`
  );
}
var HOSTS = process.env.HOST ? [process.env.HOST] : ["127.0.0.1", "::1"];
var servers = HOSTS.map(() => http.createServer(handler));
var pending = servers.length;
var bound = [];
servers.forEach((server, index) => {
  const address = HOSTS[index];
  server.on("error", (error) => {
    const code = error.code;
    if (code === "EADDRINUSE") {
      console.error(`
  Port ${PORT} is already in use. Find what holds it: netstat -ano | findstr :${PORT}
`);
      process.exit(1);
    }
    if (address === "::1" && (code === "EAFNOSUPPORT" || code === "EADDRNOTAVAIL" || code === "EINVAL")) {
      if (--pending === 0 && bound.length === 0) process.exit(1);
      return;
    }
    console.error(`
  Failed to listen on ${address}:${PORT} \u2014 ${String(error)}
`);
    process.exit(1);
  });
  server.listen(PORT, address, () => {
    bound.push(address === "::1" ? `http://[::1]:${PORT}` : `http://${address}:${PORT}`);
    if (--pending === 0) announce();
  });
});
var closeAll = () => {
  let left = servers.length;
  for (const server of servers) server.close(() => {
    if (--left === 0) process.exit(0);
  });
  setTimeout(() => process.exit(0), 5e3).unref();
};
process.on("message", (message) => {
  if (message === "shutdown") closeAll();
});
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => closeAll());
}
