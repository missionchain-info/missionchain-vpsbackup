import { FastifyPluginAsync } from 'fastify'

/**
 * Telegram Bot Webhook Handler — @nira_missionchain_bot
 *
 * Telegram POSTs every incoming message to /telegram/webhook.
 * We handle a few simple commands so users can self-serve their Chat ID
 * (needed for the Profile → Connect Telegram flow).
 *
 * Setup (one-time, on VPS):
 *   curl -F "url=https://api.missionchain.io/telegram/webhook" \
 *        -F "drop_pending_updates=true" \
 *        "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook"
 *
 * Verify:
 *   curl "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getWebhookInfo"
 */

interface TgChat   { id: number | string; type?: string }
interface TgFrom   { id?: number; username?: string; first_name?: string; last_name?: string }
interface TgMsg    { chat?: TgChat; from?: TgFrom; text?: string }
interface TgUpdate { update_id?: number; message?: TgMsg; edited_message?: TgMsg }

async function sendMessage(token: string, chatId: number | string, text: string) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      console.error('[TG-WEBHOOK] sendMessage failed', res.status, body)
    }
  } catch (err) {
    console.error('[TG-WEBHOOK] sendMessage error', err)
  }
}

export const telegramRoutes: FastifyPluginAsync = async (app) => {
  // ─── POST /telegram/webhook — receive updates from Telegram ───────
  // No auth (Telegram cannot send JWT). Lock down via a secret token in
  // the URL path if abuse becomes an issue.
  app.post('/webhook', async (req, reply) => {
    const update = (req.body || {}) as TgUpdate
    const message = update.message || update.edited_message
    if (!message?.chat?.id) return { ok: true }

    const chatId = message.chat.id
    const text = (message.text || '').trim()
    const fromName =
      message.from?.username
        ? `@${message.from.username}`
        : (message.from?.first_name || 'friend')

    const token = process.env.TELEGRAM_BOT_TOKEN
    if (!token) {
      console.warn('[TG-WEBHOOK] TELEGRAM_BOT_TOKEN missing — cannot reply')
      return { ok: true }
    }

    // /start, /chatid, /id — return the Chat ID
    if (/^\/(start|chatid|id)\b/.test(text)) {
      const reply = [
        `\u{1F44B} Hi ${fromName}!`,
        ``,
        `Welcome to *Mission Chain*.`,
        ``,
        `Your Chat ID: \`${chatId}\``,
        ``,
        `\u{1F4CB} Copy this Chat ID and paste it in your Profile -> *Social Connect* -> *Telegram* on https://app.missionchain.io/profile to link this account and receive on-chain notifications.`,
      ].join('\n')
      await sendMessage(token, chatId, reply)
      return { ok: true }
    }

    // /help — list available commands
    if (/^\/help\b/.test(text)) {
      const reply = [
        `*Mission Chain bot — Commands*`,
        ``,
        `\`/start\`  -> Get your Chat ID & welcome message`,
        `\`/id\`     -> Show your Chat ID`,
        `\`/help\`   -> This help`,
        ``,
        `Visit https://app.missionchain.io for full DApp.`,
      ].join('\n')
      await sendMessage(token, chatId, reply)
      return { ok: true }
    }

    // Any other message — short hint
    const fallback = [
      `I'm a notification bot for Mission Chain.`,
      ``,
      `Send \`/start\` to get your Chat ID, or \`/help\` to see commands.`,
    ].join('\n')
    await sendMessage(token, chatId, fallback)
    return { ok: true }
  })

  // GET helper to verify webhook is wired up (no auth — safe info only)
  app.get('/webhook/health', async () => {
    const token = process.env.TELEGRAM_BOT_TOKEN
    if (!token) return { ok: false, error: 'TELEGRAM_BOT_TOKEN not set' }
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`)
      const data = (await res.json()) as { ok: boolean; result?: any }
      return {
        ok: data.ok,
        webhookUrl: data.result?.url ?? null,
        pendingUpdates: data.result?.pending_update_count ?? 0,
        lastErrorMessage: data.result?.last_error_message ?? null,
      }
    } catch (err) {
      return { ok: false, error: 'Cannot reach Telegram' }
    }
  })
}
