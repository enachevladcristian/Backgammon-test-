/* Checks the static server serves the app and nothing else: no .git, no
   dotfiles, no traversal out of the project directory. */
import assert from 'node:assert';
import net from 'node:net';
import { createServer } from '../server.js';

const server = createServer();
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const { port } = server.address();
const base = `http://127.0.0.1:${port}`;

let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log(`  ok  ${name}`);
}

/** raw HTTP request, so the client cannot rewrite the path before it is sent */
function raw(pathname, method = 'GET') {
  return new Promise((resolve, reject) => {
    const sock = net.connect(port, '127.0.0.1', () => {
      sock.write(`${method} ${pathname} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`);
    });
    let buf = '';
    sock.setEncoding('utf8');
    sock.on('data', (d) => { buf += d; });
    sock.on('end', () => {
      const status = Number(buf.split(' ')[1]);
      const body = buf.slice(buf.indexOf('\r\n\r\n') + 4);
      resolve({ status, body, head: buf.slice(0, buf.indexOf('\r\n\r\n')) });
    });
    sock.on('error', reject);
  });
}

console.log('\nStatic server');

await test('serves the page and the modules', async () => {
  const page = await raw('/');
  assert.equal(page.status, 200);
  assert.match(page.head, /text\/html/);
  assert.match(page.body, /js\/app\.js/);
  assert.match(page.head, /no-store/);

  for (const f of ['/styles.css', '/js/app.js', '/js/scene.js', '/js/rules.js', '/js/ai.js']) {
    const r = await raw(f);
    assert.equal(r.status, 200, `${f} served`);
    assert.ok(r.body.length > 100, `${f} has content`);
  }
  const js = await raw('/js/app.js');
  assert.match(js.head, /text\/javascript/);
  assert.match(js.body, /drawSide/, 'the current build is what gets served');
});

await test('never exposes the repository metadata', async () => {
  for (const p of ['/.git/config', '/.git/HEAD', '/.git/', '/.env', '/.arena/x', '/node_modules/x.js']) {
    const r = await raw(p);
    assert.equal(r.status, 404, `${p} is not served (got ${r.status})`);
    assert.ok(!/github\.com/.test(r.body), `${p} leaks nothing`);
  }
});

await test('cannot climb out of the project directory', async () => {
  // these normalise to /etc/passwd inside the project root, which does not
  // exist, so they must 404 rather than reach the real /etc/passwd
  for (const p of ['/..%2f..%2fetc/passwd', '/js/../../etc/passwd', '/%2e%2e%2f%2e%2e%2fetc%2fpasswd', '/../../../../etc/hosts']) {
    const r = await raw(p);
    assert.equal(r.status, 404, `${p} refused (got ${r.status})`);
    assert.ok(!/root:x:0:0/.test(r.body), 'no /etc/passwd');
    assert.ok(!/localhost/.test(r.body), 'no /etc/hosts');
  }
  // a path that climbs up and back down is clamped to the project: asking for
  // /../server.js resolves to the project's own server.js
  const clamped = await raw('/%2e%2e/server.js');
  assert.equal(clamped.status, 200);
  assert.match(clamped.body, /static file server/, 'served the project copy');
});

await test('malformed escapes are a bad request, not a crash', async () => {
  const r = await raw('/%zz');
  assert.equal(r.status, 400);
  const again = await raw('/');
  assert.equal(again.status, 200, 'server still healthy');
});

await test('a protocol-relative path does not take the server down', async () => {
  // "//" used to reach new URL() unguarded and throw out of the handler
  assert.equal((await raw('//')).status, 400);
  assert.equal((await raw('///')).status, 400);
  assert.equal((await raw('/')).status, 200, 'still serving');
});

await test('missing files, directories and other verbs are handled', async () => {
  assert.equal((await raw('/nope.js')).status, 404);
  assert.equal((await raw('/js')).status, 404, 'no directory listing');
  assert.equal((await raw('/', 'POST')).status, 405);
  const head = await raw('/', 'HEAD');
  assert.equal(head.status, 200);
  assert.equal(head.body, '', 'HEAD sends no body');
});

await new Promise((r) => server.close(r));
console.log(`\n${passed} checks passed.\n`);
