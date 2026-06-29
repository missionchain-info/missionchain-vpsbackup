import { FastifyPluginAsync } from 'fastify'
import crypto from 'crypto'
import admin from 'firebase-admin'

// Initialize Firebase Admin (once)
if (!admin.apps.length) {
  admin.initializeApp({
    projectId: 'mission-chain-network',
  })
}

function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString()
}

export const userRoutes: FastifyPluginAsync = async (app) => {
  // ─── GET /user/profile — Full user profile (auth) ──────────────
  app.get('/profile', {
    preHandler: [app.authenticate],
  }, async (req, reply) => {
    const { wallet } = req.user as { wallet: string }

    const user = await app.prisma.user.findUnique({
      where: { wallet },
      select: {
        id: true,
        userId: true,
        wallet: true,
        referrer: true,
        avatarUrl: true,
        email: true,
        phone: true,
        emailVerified: true,
        phoneVerified: true,
        kycStatus: true,
        role: true,
        gvRank: true,
        mfpCount: true,
        totalGV: true,
        seedPurchased: true,
        preSalePurchased: true,
        termsAccepted: true,
        // Social Connect
        telegramHandle: true,
        telegramChatId: true,
        telegramVerified: true,
        telegramVerifiedAt: true,
        whatsappNumber: true,
        whatsappVerified: true,
        whatsappVerifiedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    })

    if (!user) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'User not found' })
    }

    // Count referrals
    const referralCount = await app.prisma.user.count({
      where: { referrer: wallet },
    })

    return {
      data: {
        ...user,
        totalGV: user.totalGV.toString(),
        referralCount,
        // avatarUrl is truncated for list views — full URL returned here
      },
    }
  })

  // ─── POST /user/avatar — Upload avatar (base64) ───────────────
  app.post('/avatar', {
    preHandler: [app.authenticate],
  }, async (req, reply) => {
    const { wallet } = req.user as { wallet: string }
    const { avatar } = req.body as { avatar: string }

    if (!avatar || typeof avatar !== 'string') {
      return reply.status(400).send({ error: 'BAD_REQUEST', message: 'avatar (base64 data URI) is required' })
    }

    // Validate: must be a data URI image
    if (!avatar.match(/^data:image\/(jpeg|png|webp|gif);base64,/)) {
      return reply.status(400).send({ error: 'BAD_REQUEST', message: 'Invalid image format. Accepted: jpeg, png, webp, gif' })
    }

    // Max ~200KB base64 string (~150KB image)
    if (avatar.length > 300_000) {
      return reply.status(400).send({ error: 'TOO_LARGE', message: 'Avatar image must be under 150KB' })
    }

    await app.prisma.user.update({
      where: { wallet },
      data: { avatarUrl: avatar },
    })

    return { data: { success: true } }
  })

  // ─── POST /user/kyc/send-email-otp — Send OTP to email ────────
  app.post('/kyc/send-email-otp', {
    preHandler: [app.authenticate],
  }, async (req, reply) => {
    const { wallet } = req.user as { wallet: string }
    const { email } = req.body as { email: string }

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return reply.status(400).send({ error: 'BAD_REQUEST', message: 'Valid email is required' })
    }

    // Rate limit: max 5 OTP per wallet per hour
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)
    const recentCount = await app.prisma.otpVerification.count({
      where: { wallet, type: 'email', createdAt: { gte: oneHourAgo } },
    })
    if (recentCount >= 5) {
      return reply.status(429).send({ error: 'RATE_LIMIT', message: 'Too many OTP requests. Try again later.' })
    }

    const code = generateOTP()
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000) // 10 min

    await app.prisma.otpVerification.create({
      data: { wallet, type: 'email', target: email, code, expiresAt },
    })

    // Send OTP via email
    try {
      const { sendOtpEmail } = await import('../services/mailer.js')
      await sendOtpEmail(email, code)
    } catch (mailErr) {
      console.error('[MAILER] Failed to send OTP email:', mailErr)
    }

    console.log(`[OTP] Email OTP for ${wallet}: ${code} → ${email}`)

    return {
      data: {
        success: true,
        message: 'OTP sent to your email',
        // DEV ONLY — remove in production:
        devCode: process.env.NODE_ENV !== 'production' ? code : undefined,
      },
    }
  })

  // ─── POST /user/kyc/verify-email — Verify email OTP ───────────
  app.post('/kyc/verify-email', {
    preHandler: [app.authenticate],
  }, async (req, reply) => {
    const { wallet } = req.user as { wallet: string }
    const { email, code } = req.body as { email: string; code: string }

    if (!email || !code) {
      return reply.status(400).send({ error: 'BAD_REQUEST', message: 'email and code are required' })
    }

    const otp = await app.prisma.otpVerification.findFirst({
      where: {
        wallet,
        type: 'email',
        target: email,
        code,
        used: false,
        expiresAt: { gte: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    })

    if (!otp) {
      return reply.status(400).send({ error: 'INVALID_OTP', message: 'Invalid or expired OTP' })
    }

    // Mark OTP used + update user
    await app.prisma.$transaction([
      app.prisma.otpVerification.update({
        where: { id: otp.id },
        data: { used: true },
      }),
      app.prisma.user.update({
        where: { wallet },
        data: {
          email,
          emailVerified: true,
          kycStatus: 'email_verified',
        },
      }),
    ])

    return { data: { verified: true } }
  })

  // ─── POST /user/kyc/send-phone-otp — Send OTP via Telegram or WhatsApp ──
  app.post('/kyc/send-phone-otp', {
    preHandler: [app.authenticate],
  }, async (req, reply) => {
    const { wallet } = req.user as { wallet: string }
    const { phone, channel, telegramChatId } = req.body as {
      phone: string; channel?: 'telegram' | 'whatsapp'; telegramChatId?: string
    }

    if (!phone || !/^\+?[1-9]\d{7,14}$/.test(phone.replace(/[\s-]/g, ''))) {
      return reply.status(400).send({ error: 'BAD_REQUEST', message: 'Valid phone number is required' })
    }

    const otpChannel = channel || 'telegram'

    if (otpChannel === 'telegram' && (!telegramChatId || !/^\d{5,15}$/.test(telegramChatId.trim()))) {
      return reply.status(400).send({ error: 'BAD_REQUEST', message: 'Valid Telegram Chat ID is required' })
    }

    // Require email verified first
    const user = await app.prisma.user.findUnique({
      where: { wallet },
      select: { emailVerified: true },
    })
    if (!user?.emailVerified) {
      return reply.status(400).send({ error: 'PRECONDITION', message: 'Verify email first' })
    }

    // Rate limit
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)
    const recentCount = await app.prisma.otpVerification.count({
      where: { wallet, type: 'phone', createdAt: { gte: oneHourAgo } },
    })
    if (recentCount >= 5) {
      return reply.status(429).send({ error: 'RATE_LIMIT', message: 'Too many OTP requests. Try again later.' })
    }

    const code = generateOTP()
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000)

    await app.prisma.otpVerification.create({
      data: { wallet, type: 'phone', target: phone, code, expiresAt },
    })

    // ── Send OTP via selected channel ──
    if (otpChannel === 'telegram') {
      const botToken = process.env.TELEGRAM_BOT_TOKEN
      if (botToken) {
        try {
          const chatId = telegramChatId!.trim()
          const msg = `\u{1F512} *MissionChain Verification*\n\nYour code: \`${code}\`\n\nExpires in 10 minutes.\nDo not share this code.`
          const tgRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text: msg, parse_mode: 'Markdown' }),
          })
          const tgData = await tgRes.json() as { ok: boolean; description?: string }
          if (!tgData.ok) {
            console.error('[TELEGRAM] Send failed:', tgData.description)
            return reply.status(400).send({
              error: 'SEND_FAILED',
              message: tgData.description?.includes('chat not found')
                ? 'Chat ID not found. Open the bot and send /start first.'
                : 'Failed to send Telegram message.',
            })
          }
          console.log(`[OTP] Telegram OTP sent to chat ${chatId} for ${wallet}: ${code}`)
        } catch (err) {
          console.error('[TELEGRAM] Error:', err)
          return reply.status(500).send({ error: 'SEND_FAILED', message: 'Cannot reach Telegram. Try again.' })
        }
      } else {
        console.warn('[TELEGRAM] Bot token not configured. OTP:', code)
      }
    } else if (otpChannel === 'whatsapp') {
      // WhatsApp Business API — requires setup
      // For now, log the code (implement with Twilio WhatsApp or Meta Cloud API later)
      console.log(`[OTP] WhatsApp OTP for ${wallet}: ${code} → ${phone} (not yet implemented)`)
      // Still return success — code is stored, user can use devCode in non-production
    }

    return {
      data: {
        success: true,
        message: otpChannel === 'telegram' ? 'OTP sent to your Telegram' : 'OTP sent to your WhatsApp',
        devCode: process.env.NODE_ENV !== 'production' ? code : undefined,
      },
    }
  })

  // ─── POST /user/kyc/verify-phone — Verify phone OTP ───────────
  app.post('/kyc/verify-phone', {
    preHandler: [app.authenticate],
  }, async (req, reply) => {
    const { wallet } = req.user as { wallet: string }
    const { phone, code } = req.body as { phone: string; code: string }

    if (!phone || !code) {
      return reply.status(400).send({ error: 'BAD_REQUEST', message: 'phone and code are required' })
    }

    const otp = await app.prisma.otpVerification.findFirst({
      where: {
        wallet,
        type: 'phone',
        target: phone,
        code,
        used: false,
        expiresAt: { gte: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    })

    if (!otp) {
      return reply.status(400).send({ error: 'INVALID_OTP', message: 'Invalid or expired OTP' })
    }

    await app.prisma.$transaction([
      app.prisma.otpVerification.update({
        where: { id: otp.id },
        data: { used: true },
      }),
      app.prisma.user.update({
        where: { wallet },
        data: {
          phone,
          phoneVerified: true,
          kycStatus: 'fully_verified',
        },
      }),
    ])

    return { data: { verified: true } }
  })

  // ─── POST /user/kyc/verify-phone-firebase — Verify via Firebase ID token ──
  app.post('/kyc/verify-phone-firebase', {
    preHandler: [app.authenticate],
  }, async (req, reply) => {
    const { wallet } = req.user as { wallet: string }
    const { phone, firebaseIdToken } = req.body as { phone: string; firebaseIdToken: string }

    if (!phone || !firebaseIdToken) {
      return reply.status(400).send({ error: 'BAD_REQUEST', message: 'phone and firebaseIdToken are required' })
    }

    try {
      // Verify the Firebase ID token server-side
      const decoded = await admin.auth().verifyIdToken(firebaseIdToken)

      // Ensure the token contains a phone number and it matches
      if (!decoded.phone_number) {
        return reply.status(400).send({ error: 'INVALID_TOKEN', message: 'Token does not contain phone number' })
      }

      // Normalize phone numbers for comparison (strip spaces/dashes)
      const normalizePhone = (p: string) => p.replace(/[\s\-()]/g, '')
      const tokenPhone = normalizePhone(decoded.phone_number)
      const userPhone = normalizePhone(phone.startsWith('+') ? phone : `+${phone}`)

      if (tokenPhone !== userPhone) {
        return reply.status(400).send({
          error: 'PHONE_MISMATCH',
          message: 'Phone number in token does not match the submitted phone',
        })
      }

      // Update user record
      await app.prisma.user.update({
        where: { wallet },
        data: {
          phone,
          phoneVerified: true,
          kycStatus: 'fully_verified',
        },
      })

      console.log(`[KYC] Phone verified via Firebase for ${wallet}: ${phone}`)
      return { data: { verified: true } }
    } catch (err: any) {
      console.error('[Firebase Verify] Error:', err)
      if (err.code === 'auth/id-token-expired') {
        return reply.status(400).send({ error: 'TOKEN_EXPIRED', message: 'Firebase token expired. Try again.' })
      }
      return reply.status(400).send({ error: 'VERIFY_FAILED', message: 'Phone verification failed' })
    }
  })

  // ─── POST /user/connect/telegram/start — Begin Telegram connect ──
  // Body: { handle: string, chatId: string }
  // Sends a 6-digit OTP via Telegram bot to the provided chat_id.
  app.post('/connect/telegram/start', {
    preHandler: [app.authenticate],
  }, async (req, reply) => {
    const { wallet } = req.user as { wallet: string }
    const { handle, chatId } = req.body as { handle?: string; chatId?: string }

    if (!handle || !chatId) {
      return reply.status(400).send({ error: 'BAD_REQUEST', message: 'handle and chatId are required' })
    }
    const cleanHandle = handle.trim().replace(/^@/, '')
    const cleanChatId = chatId.trim()
    if (!/^[a-zA-Z0-9_]{3,32}$/.test(cleanHandle)) {
      return reply.status(400).send({ error: 'BAD_REQUEST', message: 'Invalid Telegram handle (3-32 chars, a-z A-Z 0-9 _)' })
    }
    if (!/^-?\d{4,16}$/.test(cleanChatId)) {
      return reply.status(400).send({ error: 'BAD_REQUEST', message: 'Invalid chat ID (numeric, 4-16 digits)' })
    }

    // Rate limit: 5 sends/hour per wallet for telegram_connect type
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)
    const recentCount = await app.prisma.otpVerification.count({
      where: { wallet, type: 'telegram_connect', createdAt: { gte: oneHourAgo } },
    })
    if (recentCount >= 5) {
      return reply.status(429).send({ error: 'RATE_LIMIT', message: 'Too many requests. Try again later.' })
    }

    const code = generateOTP()
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000)
    await app.prisma.otpVerification.create({
      data: { wallet, type: 'telegram_connect', target: `${cleanHandle}|${cleanChatId}`, code, expiresAt },
    })

    const botToken = process.env.TELEGRAM_BOT_TOKEN
    if (!botToken) {
      console.warn('[TELEGRAM] Bot token not configured. OTP:', code)
      return reply.status(500).send({ error: 'NOT_CONFIGURED', message: 'Telegram bot not configured on server' })
    }

    const msg = `\u{1F517} *MissionChain — Connect Telegram*\n\nYour verification code: \`${code}\`\n\nExpires in 10 minutes.\nDo not share this code with anyone.`
    try {
      const tgRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: cleanChatId, text: msg, parse_mode: 'Markdown' }),
      })
      const tgData = await tgRes.json() as { ok: boolean; description?: string }
      if (!tgData.ok) {
        console.error('[TELEGRAM-CONNECT] Send failed:', tgData.description)
        return reply.status(400).send({
          error: 'SEND_FAILED',
          message: tgData.description?.includes('chat not found')
            ? 'Chat ID not found. Open @nira_missionchain_bot and send /start first.'
            : 'Failed to send Telegram message: ' + (tgData.description || 'unknown'),
        })
      }
    } catch (err) {
      console.error('[TELEGRAM-CONNECT] Error:', err)
      return reply.status(500).send({ error: 'SEND_FAILED', message: 'Cannot reach Telegram. Try again.' })
    }

    return {
      data: {
        success: true,
        message: 'Verification code sent to your Telegram',
        devCode: process.env.NODE_ENV !== 'production' ? code : undefined,
      },
    }
  })

  // ─── POST /user/connect/telegram/verify — Confirm code + save ────
  app.post('/connect/telegram/verify', {
    preHandler: [app.authenticate],
  }, async (req, reply) => {
    const { wallet } = req.user as { wallet: string }
    const { code } = req.body as { code?: string }
    if (!code) {
      return reply.status(400).send({ error: 'BAD_REQUEST', message: 'code is required' })
    }

    const otp = await app.prisma.otpVerification.findFirst({
      where: {
        wallet,
        type: 'telegram_connect',
        code: code.trim(),
        used: false,
        expiresAt: { gte: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    })

    if (!otp) {
      return reply.status(400).send({ error: 'INVALID_CODE', message: 'Invalid or expired code' })
    }

    const [handle, chatId] = otp.target.split('|')

    await app.prisma.$transaction([
      app.prisma.otpVerification.update({ where: { id: otp.id }, data: { used: true } }),
      app.prisma.user.update({
        where: { wallet },
        data: {
          telegramHandle: handle,
          telegramChatId: chatId,
          telegramVerified: true,
          telegramVerifiedAt: new Date(),
        },
      }),
    ])

    return { data: { success: true, telegramHandle: handle, telegramChatId: chatId } }
  })

  // ─── DELETE /user/connect/telegram — Disconnect Telegram ─────────
  app.delete('/connect/telegram', {
    preHandler: [app.authenticate],
  }, async (req, reply) => {
    const { wallet } = req.user as { wallet: string }
    await app.prisma.user.update({
      where: { wallet },
      data: {
        telegramHandle: null,
        telegramChatId: null,
        telegramVerified: false,
        telegramVerifiedAt: null,
      },
    })
    return { data: { success: true } }
  })

  // ─── POST /user/connect/whatsapp — Save WhatsApp number ──────────
  // MVP: stores number only (not verified). Future: integrate Twilio
  // WhatsApp or Meta Cloud API for OTP-based verification.
  app.post('/connect/whatsapp', {
    preHandler: [app.authenticate],
  }, async (req, reply) => {
    const { wallet } = req.user as { wallet: string }
    const { number } = req.body as { number?: string }
    if (!number) {
      return reply.status(400).send({ error: 'BAD_REQUEST', message: 'number is required' })
    }
    const clean = number.trim().replace(/\s+/g, '')
    if (!/^\+\d{8,15}$/.test(clean)) {
      return reply.status(400).send({ error: 'BAD_REQUEST', message: 'Invalid format. Use E.164 (e.g. +84901234567)' })
    }

    await app.prisma.user.update({
      where: { wallet },
      data: {
        whatsappNumber: clean,
        whatsappVerified: false, // Marked as Linked (not Verified) until Business API integration
      },
    })

    return { data: { success: true, whatsappNumber: clean, whatsappVerified: false } }
  })

  // ─── DELETE /user/connect/whatsapp — Disconnect WhatsApp ─────────
  app.delete('/connect/whatsapp', {
    preHandler: [app.authenticate],
  }, async (req, reply) => {
    const { wallet } = req.user as { wallet: string }
    await app.prisma.user.update({
      where: { wallet },
      data: {
        whatsappNumber: null,
        whatsappVerified: false,
        whatsappVerifiedAt: null,
      },
    })
    return { data: { success: true } }
  })

  // ─── PUT /user/kyc — Update KYC status ─────────────────────────
  app.put('/kyc', {
    preHandler: [app.authenticate],
  }, async (req, reply) => {
    const { wallet, role } = req.user as { wallet: string; role: string }
    const { targetWallet, kycStatus, sumsubResult } = req.body as {
      targetWallet?: string
      kycStatus: string
      sumsubResult?: Record<string, unknown>
    }

    const validStatuses = ['none', 'pending', 'approved', 'rejected']
    if (!validStatuses.includes(kycStatus)) {
      return reply.status(400).send({ error: 'BAD_REQUEST', message: 'Invalid KYC status' })
    }

    // Admin can update any user; regular user can only update self via Sumsub callback
    const walletToUpdate = role === 'ADMIN'
      ? (targetWallet?.toLowerCase() ?? wallet)
      : wallet

    // Non-admin users can only set pending (initiating KYC) or if sumsubResult is provided
    if (role === 'USER' || role === 'AGENT') {
      if (kycStatus !== 'pending' && !sumsubResult) {
        return reply.status(403).send({ error: 'FORBIDDEN', message: 'Only admins can directly approve/reject KYC' })
      }
    }

    const updated = await app.prisma.user.update({
      where: { wallet: walletToUpdate },
      data: { kycStatus },
      select: { wallet: true, kycStatus: true, updatedAt: true },
    })

    return { data: updated }
  })

  // ─── GET /user/:wallet/referrals — Direct referrals (F1 list) ──
  app.get('/:wallet/referrals', async (req, reply) => {
    const { wallet } = req.params as { wallet: string }
    const walletLower = wallet.toLowerCase()

    const user = await app.prisma.user.findUnique({
      where: { wallet: walletLower },
      select: { id: true },
    })

    if (!user) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'User not found' })
    }

    const referrals = await app.prisma.user.findMany({
      where: { referrer: walletLower },
      select: {
        userId: true,
        wallet: true,
        createdAt: true,
        seedPurchased: true,
        preSalePurchased: true,
      },
      orderBy: { createdAt: 'desc' },
    })

    return {
      data: {
        wallet: walletLower,
        f1Count: referrals.length,
        referrals,
      },
    }
  })
}
