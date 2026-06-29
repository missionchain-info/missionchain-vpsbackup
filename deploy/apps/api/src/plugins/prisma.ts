import fp from 'fastify-plugin'
import { PrismaClient } from '@missionchain/db'
import { FastifyPluginAsync } from 'fastify'

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient
  }
}

const prismaPlugin: FastifyPluginAsync = fp(async (fastify) => {
  const prisma = new PrismaClient({
    log:
      process.env.NODE_ENV === 'development'
        ? ['query', 'warn', 'error']
        : ['warn', 'error'],
  })

  await prisma.$connect()
  fastify.log.info('Prisma connected to database')

  fastify.decorate('prisma', prisma)

  fastify.addHook('onClose', async () => {
    fastify.log.info('Disconnecting Prisma...')
    await prisma.$disconnect()
  })
})

export default prismaPlugin
