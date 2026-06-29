import { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { randomBytes } from 'crypto'
import { verifyMessage } from 'ethers'


// Member Account rule (anh's spec May 7, 2026):
// — letters (A-Z, a-z), numbers (0-9), underscore (_)
// — length 5 to 12 characters
// — no other special characters
const USERID_REGEX = /^[A-Za-z0-9_]{5,12}$/

const RegisterSchema = z.object({
  wallet: z.string().min(42).max(42).regex(/^0x[a-fA-F0-9]{40}$/),
  userId: z.string().min(5).max(12).regex(USERID_REGEX),
  referrer: z.string().optional(),
  termsAccepted: z.literal(true),
})

const VerifySchema = z.object({
  wallet: z.string().min(42).max(42).regex(/^0x[a-fA-F0-9]{40}$/),
  signature: z.string().min(1),
})

export const authRoutes: FastifyPluginAsync = async (app) => {
  // ─── Check if User ID is available ───────────────────────────────
  app.get('/check-userid', async (req, reply) => {
    const { userId } = req.query as { userId?: string }
    if (!userId || !USERID_REGEX.test(userId)) {
      return { available: false }
    }

    const existing = await app.prisma.user.findFirst({
      where: { userId: { equals: userId, mode: "insensitive" } },
      select: { id: true },
    })
    return { available: !existing }
  })

  // ─── Check if referrer exists ────────────────────────────────────
  // Used by:
  //   - register flow (validate referrer before sign-up)
  //   - admin Distributor Management (bidirectional auto-fill: ID ↔ wallet)
  app.get('/check-referrer', async (req, reply) => {
    const { ref } = req.query as { ref?: string }
    if (!ref) return { valid: false }

    const refLower = ref.toLowerCase()

    // Search by wallet address or userId
    const found = await app.prisma.user.findFirst({
      where: {
        OR: [
          { wallet: refLower },
          { userId: { equals: ref, mode: "insensitive" } },
        ],
      },
      select: { userId: true, wallet: true },
    })

    return {
      valid: !!found,
      name: found?.userId ?? undefined,
      wallet: found?.wallet ?? undefined,
    }
  })

  // ─── Register new user ──────────────────────────────────────────
  app.post('/register', { config: { rateLimit: { max: 10, timeWindow: 60000 } } }, async (req, reply) => {
    const parsed = RegisterSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'BAD_REQUEST', message: parsed.error.issues[0]?.message || 'Invalid input' })
    }
    const { wallet, userId, referrer, termsAccepted } = parsed.data

    const walletLower = wallet.toLowerCase()

    // Check wallet duplicate
    const existingWallet = await app.prisma.user.findUnique({
      where: { wallet: walletLower },
      select: { id: true },
    })
    if (existingWallet) {
      return reply.status(409).send({ error: 'CONFLICT', message: 'Wallet already registered' })
    }

    // Check userId duplicate
    const existingUserId = await app.prisma.user.findFirst({
      where: { userId: { equals: userId, mode: "insensitive" } },
      select: { id: true },
    })
    if (existingUserId) {
      return reply.status(409).send({ error: 'CONFLICT', message: 'userId already taken' })
    }

    // Validate referrer if provided.
    // If user signs up without a referrer, fall back to SystemConfig
    // 'default_referrer_wallet' (= vcm2015 wallet) so every member has an upline.
    let referrerWallet: string | undefined
    if (referrer) {
      const referrerLower = referrer.toLowerCase()
      const referrerUser = await app.prisma.user.findFirst({
        where: {
          OR: [
            { wallet: referrerLower },
            { userId: { equals: referrer, mode: "insensitive" } },
          ],
        },
        select: { wallet: true },
      })
      if (!referrerUser) {
        return reply.status(400).send({ error: 'BAD_REQUEST', message: 'Referrer not found' })
      }
      referrerWallet = referrerUser.wallet
    } else {
      const defaultRef = await app.prisma.systemConfig.findUnique({
        where: { key: 'default_referrer_wallet' },
        select: { value: true },
      })
      if (defaultRef?.value) {
        referrerWallet = defaultRef.value.toLowerCase()
      }
    }

    // Create nonce
    const nonceValue = randomBytes(32).toString('hex')
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000) // 10 minutes

    // Create user + nonce in a transaction
    await app.prisma.$transaction([
      app.prisma.user.create({
        data: {
          wallet: walletLower,
          userId,
          referrer: referrerWallet ?? null,
          termsAccepted,
        },
      }),
      app.prisma.nonce.create({
        data: {
          wallet: walletLower,
          nonce: nonceValue,
          expiresAt,
        },
      }),
    ])

    return { success: true, nonce: nonceValue }
  })

  // ─── Get nonce for existing user ────────────────────────────────
  app.get('/nonce', { config: { rateLimit: { max: 20, timeWindow: 60000 } } }, async (req, reply) => {
    const { wallet } = req.query as { wallet?: string }
    if (!wallet) {
      return reply.status(400).send({ error: 'BAD_REQUEST', message: 'Missing wallet' })
    }

    const walletLower = wallet.toLowerCase()

    const user = await app.prisma.user.findUnique({
      where: { wallet: walletLower },
      select: { id: true, userId: true },
    })
    if (!user) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'User not found' })
    }

    // Invalidate any existing unused nonces for this wallet
    await app.prisma.nonce.updateMany({
      where: { wallet: walletLower, used: false },
      data: { used: true },
    })

    // Create fresh nonce
    const nonceValue = randomBytes(32).toString('hex')
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000)

    await app.prisma.nonce.create({
      data: {
        wallet: walletLower,
        nonce: nonceValue,
        expiresAt,
      },
    })

    return { nonce: nonceValue, userId: user.userId }
  })

  // ─── Verify signature and issue JWT ─────────────────────────────
  app.post('/verify', { config: { rateLimit: { max: 10, timeWindow: 60000 } } }, async (req, reply) => {
    const parsed = VerifySchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'BAD_REQUEST', message: parsed.error.issues[0]?.message || 'Invalid input' })
    }
    const { wallet, signature } = parsed.data

    const walletLower = wallet.toLowerCase()

    // Find the latest unused, unexpired nonce
    const nonceRecord = await app.prisma.nonce.findFirst({
      where: {
        wallet: walletLower,
        used: false,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    })

    if (!nonceRecord) {
      return reply.status(400).send({ error: 'BAD_REQUEST', message: 'No pending nonce' })
    }

    try {
      const message = `Mission Chain Authentication\nNonce: ${nonceRecord.nonce}`
      const recovered = verifyMessage(message, signature)

      if (recovered.toLowerCase() !== walletLower) {
        return reply.status(401).send({ error: 'UNAUTHORIZED', message: 'Invalid signature' })
      }

      const user = await app.prisma.user.findUnique({
        where: { wallet: walletLower },
        select: { id: true, userId: true, wallet: true, role: true },
      })

      if (!user) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: 'User not found' })
      }

      // Mark nonce as used
      await app.prisma.nonce.update({
        where: { id: nonceRecord.id },
        data: { used: true },
      })

      // Collapse top-tier role into ADMIN for client-visible JWT/response.
      // True top-tier privilege is decided server-side via isOwnerWallet().
      const clientRole = user.role === 'SUPER_ADMIN' ? 'ADMIN' : user.role

      const token = app.jwt.sign({
        sub: user.id,
        wallet: user.wallet,
        userId: user.userId,
        role: clientRole,
      }, {
        expiresIn: clientRole === 'ADMIN' ? '4h' : '12h',
      })

      return {
        jwt: token,
        user: {
          id: user.id,
          userId: user.userId,
          wallet: user.wallet,
          role: clientRole,
        },
      }
    } catch {
      return reply.status(401).send({ error: 'UNAUTHORIZED', message: 'Signature verification failed' })
    }
  })

  // ─── Get current user from JWT ──────────────────────────────────
  app.get('/me', {
    preHandler: [app.authenticate],
  }, async (req, reply) => {
    const { wallet } = req.user as { wallet: string }

    const user = await app.prisma.user.findUnique({
      where: { wallet },
      select: {
        id: true,
        userId: true,
        wallet: true,
        kycStatus: true,
        role: true,
        gvRank: true,
        mfpCount: true,
        seedPurchased: true,
        preSalePurchased: true,
        termsAccepted: true,
        createdAt: true,
      },
    })

    if (!user) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'User not found' })
    }

    // Collapse top-tier role into ADMIN for client visibility.
    return {
      data: {
        ...user,
        role: user.role === 'SUPER_ADMIN' ? 'ADMIN' : user.role,
      },
    }
  })
}
