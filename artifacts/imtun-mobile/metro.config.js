const { getDefaultConfig } = require('expo/metro-config');
const { createDevApiProxy } = require('./scripts/dev-api-proxy.cjs');

const config = getDefaultConfig(__dirname);
const enhance = config.server.enhanceMiddleware;
config.server.enhanceMiddleware = (middleware, server) => {
  const next = enhance ? enhance(middleware, server) : middleware;
  if (process.env.NODE_ENV === 'production' || !process.env.REPLIT_EXPO_DEV_DOMAIN) return next;
  const proxy = createDevApiProxy({
    origins: [`https://${process.env.REPLIT_EXPO_DEV_DOMAIN}`, `http://localhost:${process.env.PORT}`],
  });
  return (req, res, done) => proxy(req, res, () => next(req, res, done));
};
module.exports = config;
