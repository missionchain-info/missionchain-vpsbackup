import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';

const PORT = Number(process.env.PORT) || 4000;

async function buildApp() {
  const app = Fastify({
    logger: {
      level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
    },
  });

  // Plugins
  await app.register(cors, {
    origin: [
      'https://missionchain.info',
      'https://www.missionchain.info',
      'https://missionchain.world',
      'https://www.missionchain.world',
      'https://missionchain.io',
      'https://admin.missionchain.io',
      'http://localhost:3001',
      'http://localhost:3002',
      'http://localhost:3003',
    ],
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  await app.register(cookie);

  await app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
  });

  // Health check
  app.get('/health', async () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  }));

  // API v1 routes
  app.get('/v1/health', async () => ({
    status: 'ok',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  }));

  // Auth routes placeholder
  app.post('/v1/auth/register', async (req, reply) => {
    return { message: 'Registration endpoint — coming soon' };
  });

  app.post('/v1/auth/login', async (req, reply) => {
    return { message: 'Login endpoint — coming soon' };
  });

  app.get('/v1/auth/nonce/:address', async (req, reply) => {
    const { address } = req.params as { address: string };
    return { nonce: `mc-nonce-${Date.now()}-${address.slice(0, 8)}` };
  });

  app.post('/v1/auth/wallet-login', async (req, reply) => {
    return { message: 'Wallet login — coming soon' };
  });

  // Admin routes placeholder
  app.get('/v1/admin/stats', async () => ({
    totalUsers: 0,
    pendingKyc: 0,
    activeMiners: 0,
    seedRoundActive: true,
  }));

  return app;
}

buildApp().then(app => {
  app.listen({ port: PORT, host: '0.0.0.0' }, (err, address) => {
    if (err) {
      app.log.error(err);
      process.exit(1);
    }
    app.log.info(`MissionChain API running at ${address}`);
  });
});
