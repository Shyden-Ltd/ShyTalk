#!/usr/bin/env node
/**
 * serve-web.js — zero-dependency static file server for the local web tier.
 *
 * Replaces `npx serve public -l 8888`, which dies mid-suite under the heavy
 * Playwright/Chromium load (SHY-0180): `serve`'s `npm exec` wrapper receives a
 * SIGINT/SIGTERM ~15 min into a run and its graceful-shutdown path then crashes
 * on an EBADF from an in-flight file read — turning the tail of the suite into
 * mass ERR_CONNECTION_REFUSED phantom failures (blocked SHY-0095's push 3×;
 * ~5 confirmed deaths). A clean-URL express-static server with NO npm-exec
 * wrapper survived the identical suite end-to-end, so this is that, dependency-
 * free (Node core `http`/`fs`/`path` only — nothing to `npm exec`, leaner, and
 * signal-safe).
 *
 * Parity with the `serve` behaviour the suite relies on:
 *   - clean URLs: `/admin/reports` → `admin/reports.html` if it exists
 *   - directory index: `/` and `/admin/` → `index.html`
 *   - correct Content-Type for the asset types the app serves
 *   - 404 for anything unresolved (never path-escapes the web root)
 *
 * Robustness (why it can't repeat serve's crash):
 *   - every response stream has an `error` handler, so an fd hiccup during an
 *     in-flight read ends THAT request 500 instead of throwing an unhandled
 *     'error' event that takes the whole process down
 *   - SIGINT/SIGTERM close the server and exit 0 cleanly — no half-torn-down fd
 *     races
 *
 * Usage:  node local/serve-web.js [--port 8888] [--root public] [--quiet]
 */
const http = require("http");
const fs = require("fs");
const path = require("path");

function parseArgs(argv) {
  const opts = { port: 8888, root: "public", quiet: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--port" || argv[i] === "-l")
      opts.port = parseInt(argv[++i], 10);
    else if (argv[i] === "--root") opts.root = argv[++i];
    else if (argv[i] === "--quiet" || argv[i] === "--no-clipboard")
      opts.quiet = true;
  }
  return opts;
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
};

function contentType(filePath) {
  return (
    MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream"
  );
}

/**
 * Resolves a request URL path to an absolute file inside `root`, applying
 * serve's clean-URL + directory-index rules. Returns null if nothing resolves
 * OR if the path would escape the web root (defense against `..` traversal).
 */
function resolveFile(root, urlPath) {
  const absRoot = path.resolve(root);
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.split("?")[0].split("#")[0]);
  } catch {
    // Malformed percent-encoding (e.g. a lone `%`) → decodeURIComponent throws.
    // Treat as unresolvable rather than let the throw crash the request handler.
    return null;
  }
  // Normalize + confine to the root: a resolved path outside absRoot is rejected.
  const requested = path.resolve(absRoot, `.${decoded}`);
  if (requested !== absRoot && !requested.startsWith(absRoot + path.sep))
    return null;

  const candidates = [];
  const endsWithSlash = decoded.endsWith("/");
  if (endsWithSlash) {
    candidates.push(path.join(requested, "index.html"));
  } else {
    candidates.push(requested); // exact file
    candidates.push(`${requested}.html`); // clean URL
    candidates.push(path.join(requested, "index.html")); // extensionless dir
  }
  for (const c of candidates) {
    try {
      if (fs.statSync(c).isFile()) return c;
    } catch {
      // not this candidate — try the next
    }
  }
  return null;
}

function createServer({ root }) {
  return http.createServer((req, res) => {
    const file = resolveFile(root, req.url || "/");
    if (!file) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("404 Not Found");
      return;
    }
    const stream = fs.createReadStream(file);
    // THE robustness fix vs `serve`: a read error ends only THIS request,
    // never the process (serve emits an unhandled 'error' → whole-process
    // crash). Headers are written on 'open', NOT before: if the open fails
    // (ENOENT from a statSync→open TOCTOU race, EACCES, EMFILE under load)
    // the 'error' handler still owns the response and can send a real 500 —
    // writing 200 up front would make `!res.headersSent` dead code and ship
    // a misleading "200 + empty body" for a failed read.
    stream.on("error", (err) => {
      // Errors ALWAYS log (independent of --quiet, which only silences the
      // startup banner) — a read failure under load is the exact signal this
      // server exists to surface, per the Observability AC.
      process.stderr.write(`[serve-web] read error ${file}: ${err.code}\n`);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
    stream.on("open", () => {
      res.writeHead(200, { "Content-Type": contentType(file) });
      stream.pipe(res);
    });
  });
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const server = createServer({ root: opts.root });
  server.listen(opts.port, () => {
    // One-line startup banner. --quiet/--no-clipboard are accepted for CLI
    // parity with `serve` but no longer gate anything (read errors always
    // log; this banner is a single harmless line).
    if (!opts.quiet)
      process.stdout.write(
        `[serve-web] serving ${path.resolve(opts.root)} on http://localhost:${opts.port} (pid ${process.pid})\n`,
      );
  });
  // Clean shutdown — no half-torn-down fd race, exit 0.
  for (const sig of ["SIGINT", "SIGTERM"]) {
    process.on(sig, () => {
      process.stdout.write(`[serve-web] ${sig} — closing\n`);
      server.close(() => process.exit(0));
      // Don't hang on lingering keep-alive sockets.
      setTimeout(() => process.exit(0), 1000).unref();
    });
  }
}

if (require.main === module) main();

module.exports = { parseArgs, contentType, resolveFile, createServer, MIME };
