/* Tiny dependency-free static file server (ES modules need http://).
   Only serves project files: dotfiles, .git and node_modules are never
   reachable, and nothing outside the project directory can be read. */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

/** Segments that must never be served, even though they live under ROOT. */
function isBlocked(rel) {
  return rel
    .split(/[\\/]+/)
    .filter(Boolean)
    .some((seg) => seg.startsWith('.') || seg === 'node_modules');
}

/**
 * Map a request pathname to a file inside ROOT.
 * Returns { file } when it may be served, or { status } when it may not.
 */
export function resolveRequest(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return { status: 400 };           // malformed %-escape
  }
  if (decoded.includes('\0')) return { status: 400 };

  // normalize the absolute URL path first: leading ".." collapse at "/", so the
  // join below can never climb out of ROOT
  let rel = path.normalize(decoded);
  if (rel.endsWith('/') || rel.endsWith(path.sep)) rel = path.join(rel, 'index.html');
  if (isBlocked(rel)) return { status: 404 };   // .git, dotfiles, node_modules

  const file = path.join(ROOT, rel);
  const inside = file === ROOT || file.startsWith(ROOT + path.sep);
  if (!inside) return { status: 403 };
  return { file };
}

export function handler(req, res) {
  const send = (status, body, headers = {}) => {
    const head = req.method === 'HEAD';
    res.writeHead(status, {
      'cache-control': 'no-store, must-revalidate',
      'pragma': 'no-cache',
      'expires': '0',
      'x-content-type-options': 'nosniff',
      ...headers,
    });
    res.end(head || status === 204 ? undefined : body);
  };

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    send(405, 'Method not allowed', { 'content-type': 'text/plain; charset=utf-8', allow: 'GET, HEAD' });
    return;
  }

  let pathname;
  try {
    ({ pathname } = new URL(req.url, `http://${req.headers.host || 'localhost'}`));
  } catch {
    send(400, 'Bad request', { 'content-type': 'text/plain; charset=utf-8' });
    return;
  }
  const { file, status } = resolveRequest(pathname);
  if (status) {
    send(status, status === 403 ? 'Forbidden' : status === 400 ? 'Bad request' : 'Not found', {
      'content-type': 'text/plain; charset=utf-8',
    });
    return;
  }

  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      send(404, 'Not found', { 'content-type': 'text/plain; charset=utf-8' });
      return;
    }
    fs.readFile(file, (readErr, data) => {
      if (readErr) {
        send(404, 'Not found', { 'content-type': 'text/plain; charset=utf-8' });
        return;
      }
      send(200, data, {
        'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'content-length': data.length,
      });
    });
  });
}

export function createServer() {
  return http.createServer(handler);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  createServer().listen(PORT, HOST, () => {
    console.log(`Backgammon running at http://localhost:${PORT}`);
  });
}
