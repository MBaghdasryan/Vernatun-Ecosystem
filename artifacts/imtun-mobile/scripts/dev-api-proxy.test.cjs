const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { createDevApiProxy } = require('./dev-api-proxy.cjs');

test('development proxy preserves sessions/CSRF and rejects foreign origins and redirects', async () => {
  const calls = [];
  const upstream = http.createServer((req, res) => {
    calls.push({ path: req.url, headers: req.headers });
    if (req.url === '/api/redirect') {
      res.writeHead(302, { location: 'https://example.invalid/private' }).end();
      return;
    }
    res.setHeader('set-cookie', 'vernatun.sid=test-only; HttpOnly; SameSite=Lax');
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ csrf: req.headers['x-csrf-token'] ?? null }));
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  let proxy;
  const server = http.createServer((req, res) => proxy(req, res, () => res.writeHead(404).end()));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const base = origin + '/__imtun_dev_api';
  proxy = createDevApiProxy({ origins: [origin], routerPort: upstream.address().port });
  try {
    const response = await fetch(base + '/api/auth/login', {
      method: 'POST',
      headers: { origin, cookie: 'vernatun.sid=old', 'x-csrf-token': 'test-token', 'content-type': 'application/json' },
      body: '{}',
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).csrf, 'test-token');
    assert.match(response.headers.get('set-cookie'), /HttpOnly/);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(calls[0].headers.cookie, 'vernatun.sid=old');
    assert.equal(calls[0].headers.origin, undefined);
    assert.equal(calls[0].path, '/api/auth/login');
    assert.equal((await fetch(base + '/api/auth/session', { headers: { origin: 'https://evil.invalid' } })).status, 403);
    assert.equal((await fetch(base + '/api/auth/session', { headers: { 'sec-fetch-site': 'cross-site' } })).status, 403);
    const foreignHost = await new Promise(resolve => {
      http.get(base + '/api/auth/session', { headers: { host: 'evil.invalid' } }, response => {
        response.resume();
        resolve(response.statusCode);
      });
    });
    assert.equal(foreignHost, 403);
    assert.equal(calls.length, 1);
    assert.equal((await fetch(base + '/api/redirect')).status, 502);
    assert.equal((await fetch(origin + '/not-api')).status, 404);
    assert.equal(calls.length, 2);
  } finally {
    server.closeAllConnections(); upstream.closeAllConnections();
    await Promise.all([new Promise(r => server.close(r)), new Promise(r => upstream.close(r))]);
  }
});
