// Metro-only, same-origin bridge. Never forward to an environment-provided API
// URL: port 80 is this workspace's artifact router, not the published service.
const http = require('node:http');

function createDevApiProxy({ origins, routerPort = 80 }) {
  const allowed = new Set(origins);
  return (req, res, next) => {
    const prefix = '/__imtun_dev_api';
    if (!req.url?.startsWith(`${prefix}/api/`)) return next();
    res.setHeader('Cache-Control', 'no-store');
    const origin = req.headers.origin;
    const site = req.headers['sec-fetch-site'];
    const host = req.headers.host;
    if (!origins.some(value => new URL(value).host === host) ||
        (origin && !allowed.has(origin)) ||
        (site && !['same-origin', 'none'].includes(site))) {
      res.writeHead(403).end('Development API origin rejected');
      return;
    }
    // Keep the existing cookie/session and CSRF-token contract. Only after
    // validating the browser origin above, omit Origin for the local API.
    // Do not forward arbitrary Host, forwarding or authorization headers.
    const headers = { host: 'localhost' };
    for (const name of ['accept', 'content-type', 'content-length', 'cookie', 'x-csrf-token']) {
      if (req.headers[name]) headers[name] = req.headers[name];
    }
    const upstream = http.request({
      hostname: '127.0.0.1', port: routerPort, path: req.url.slice(prefix.length),
      method: req.method, headers, timeout: 30_000,
    }, response => {
      // Never let a redirect escape to another API or a public storage URL.
      if (response.statusCode >= 300 && response.statusCode < 400) {
        response.resume();
        res.writeHead(502).end('Development API redirects are disabled');
        return;
      }
      for (const name of ['content-type', 'content-disposition', 'set-cookie']) {
        if (response.headers[name]) res.setHeader(name, response.headers[name]);
      }
      res.writeHead(response.statusCode || 502);
      response.on('error', () => res.destroy());
      response.pipe(res);
    });
    upstream.on('timeout', () => upstream.destroy(new Error('API timeout')));
    upstream.on('error', () => {
      if (!res.headersSent) res.writeHead(502).end('Local development API unavailable');
      else res.destroy();
    });
    req.on('aborted', () => upstream.destroy());
    res.on('close', () => upstream.destroy());
    req.pipe(upstream);
  };
}

module.exports = { createDevApiProxy };
