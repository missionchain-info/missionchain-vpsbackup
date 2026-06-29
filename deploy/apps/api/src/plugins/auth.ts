import fp from 'fastify-plugin'
import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify'

// ─── Type Augmentation ───────────────────────────────────────────────

export interface JWTPayload {
  sub: string
  wallet: string
  userId: string
  role?: string
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>
  }
  interface FastifyRequest {
    user: JWTPayload
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: JWTPayload
    user: JWTPayload
  }
}

// ─── Auth Plugin ─────────────────────────────────────────────────────

const authPlugin: FastifyPluginAsync = fp(async (fastify) => {
  // Note: @fastify/jwt already decorates request.user, so we don't re-decorate

  // Decorate instance with `authenticate` so routes can use
  // `{ preHandler: [app.authenticate] }` directly.
  fastify.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const decoded = await request.jwtVerify<JWTPayload>()
      request.user = decoded
    } catch {
      reply.status(401).send({ error: 'UNAUTHORIZED', message: 'Invalid or missing token' })
    }
  })
})

export default authPlugin

// ─── Reusable preHandler ─────────────────────────────────────────────

/**
 * preHandler that validates JWT from Authorization header and attaches
 * the decoded payload to `request.user`. Returns 401 on invalid/missing token.
 *
 * Usage:
 *   app.get('/protected', { preHandler: [requireAuth] }, handler)
 */
export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    const decoded = await request.jwtVerify<JWTPayload>()
    request.user = decoded
  } catch (err) {
    reply.status(401).send({ message: 'Unauthorized: invalid or missing token' })
  }
}
