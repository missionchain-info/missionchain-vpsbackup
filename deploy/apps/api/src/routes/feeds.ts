import { FastifyPluginAsync } from 'fastify'
import { requireLevel } from '../plugins/rbac'

const PILLARS = ['ai', 'tech', 'finance', 'faith', 'announcement']
const STATUSES = ['draft', 'pending_review', 'approved', 'published', 'rejected']

// ─── AI editor: grammar/style + compliance pre-check (OpenAI) ─────────
async function aiEditorCheck(title: string, body: string, pillar: string) {
  const key = process.env.OPENAI_API_KEY
  if (!key) return { enabled: false, error: 'ai_disabled' }
  const sys = `Bạn là biên tập viên nội bộ của Mission Chain — dự án Web3 lấy cảm hứng từ đức tin (jurisdiction USA).
Nhiệm vụ: kiểm tra văn bản (tiếng Việt hoặc tiếng Anh), sửa chính tả, ngữ pháp, dấu câu và văn phong cho mạch lạc, chuyên nghiệp. TUYỆT ĐỐI GIỮ NGUYÊN Ý, không thêm thông tin mới.
Quy tắc tuân thủ (đưa cảnh báo vào compliance_flags nếu vi phạm):
- Tài chính: KHÔNG hứa lợi nhuận/ROI, KHÔNG dự đoán giá, KHÔNG lời khuyên đầu tư ("securities"/"guaranteed").
- Đức tin: giọng tôn trọng, không lợi dụng; trích Kinh Thánh phải đúng (bản công cộng WEB/KJV).
- Nguồn ngoài: nếu như đang sao chép nguyên văn, gợi ý viết lại + ghi nguồn.
Chỉ trả về JSON hợp lệ: {"corrected_title": string, "corrected_body": string, "notes": string[], "compliance_flags": string[]}`
  const usr = `pillar: ${pillar}\n\nTITLE:\n${title}\n\nBODY:\n${body}`
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: usr },
        ],
      }),
    })
    if (!res.ok) {
      const t = await res.text()
      return { enabled: true, error: 'ai_error', detail: t.slice(0, 300) }
    }
    const data: any = await res.json()
    let parsed: any = {}
    try { parsed = JSON.parse(data.choices?.[0]?.message?.content || '{}') } catch { parsed = {} }
    return {
      enabled: true,
      correctedTitle: typeof parsed.corrected_title === 'string' ? parsed.corrected_title : title,
      correctedBody: typeof parsed.corrected_body === 'string' ? parsed.corrected_body : body,
      notes: Array.isArray(parsed.notes) ? parsed.notes.map(String) : [],
      complianceFlags: Array.isArray(parsed.compliance_flags) ? parsed.compliance_flags.map(String) : [],
    }
  } catch (e: any) {
    return { enabled: true, error: 'ai_exception', detail: String(e?.message || e) }
  }
}

export const feedsRoutes: FastifyPluginAsync = async (app) => {
  const OP = { preHandler: [requireLevel('OPERATOR')] }

  // ─── ADMIN: AI editor check (grammar/style/compliance) ───
  app.post('/admin/ai-check', OP, async (req) => {
    const b = (req.body as any) || {}
    return aiEditorCheck(String(b.title || ''), String(b.body || ''), String(b.pillar || 'announcement'))
  })

  // ─── ADMIN: list all items (any status) ───
  app.get('/admin', OP, async (req) => {
    const q = req.query as any
    const limit = Math.min(Number(q.limit) || 50, 100)
    const where: any = {}
    if (q.status && q.status !== 'all') where.status = String(q.status)
    if (q.pillar && q.pillar !== 'all') where.pillar = String(q.pillar)
    const items = await app.prisma.feedItem.findMany({ where, orderBy: [{ createdAt: 'desc' }], take: limit })
    return { items }
  })

  // ─── ADMIN: create ───
  app.post('/admin', OP, async (req, reply) => {
    const b = (req.body as any) || {}
    if (!b.title || !b.body) return reply.code(400).send({ error: 'title_body_required' })
    if (b.pillar && !PILLARS.includes(b.pillar)) return reply.code(400).send({ error: 'bad_pillar' })
    const status = STATUSES.includes(b.status) ? b.status : 'draft'
    const item = await app.prisma.feedItem.create({
      data: {
        type: b.type || 'card',
        pillar: b.pillar || 'announcement',
        title: String(b.title),
        body: String(b.body),
        media: b.media ?? undefined,
        lang: b.lang || 'vi',
        sourceUrl: b.sourceUrl || null,
        sourceAttribution: b.sourceAttribution || null,
        verseRef: b.verseRef || null,
        verseText: b.verseText || null,
        pinned: !!b.pinned,
        status,
        createdBy: 'admin',
        publishedAt: status === 'published' ? new Date() : null,
      },
    })
    return item
  })

  // ─── ADMIN: update / change status ───
  app.patch('/admin/:id', OP, async (req, reply) => {
    const { id } = req.params as any
    const b = (req.body as any) || {}
    const existing = await app.prisma.feedItem.findUnique({ where: { id } })
    if (!existing) return reply.code(404).send({ error: 'not_found' })
    if (b.pillar && !PILLARS.includes(b.pillar)) return reply.code(400).send({ error: 'bad_pillar' })
    if (b.status && !STATUSES.includes(b.status)) return reply.code(400).send({ error: 'bad_status' })
    const data: any = {}
    for (const f of ['type', 'pillar', 'title', 'body', 'lang', 'sourceUrl', 'sourceAttribution', 'verseRef', 'verseText', 'status']) {
      if (b[f] !== undefined) data[f] = b[f]
    }
    if (b.media !== undefined) data.media = b.media
    if (b.pinned !== undefined) data.pinned = !!b.pinned
    if (b.status === 'published' && existing.status !== 'published') data.publishedAt = new Date()
    const item = await app.prisma.feedItem.update({ where: { id }, data })
    return item
  })

  // ─── ADMIN: delete ───
  app.delete('/admin/:id', OP, async (req, reply) => {
    const { id } = req.params as any
    await app.prisma.feedItem.delete({ where: { id } }).catch(() => {})
    return reply.code(204).send()
  })

  // ─── PUBLIC: list published ───
  app.get('/', async (req) => {
    const q = req.query as any
    const limit = Math.min(Number(q.limit) || 20, 50)
    const cursor = q.cursor as string | undefined
    const where: any = { status: 'published' }
    if (q.pillar && q.pillar !== 'all') where.pillar = String(q.pillar)
    if (q.lang) where.lang = String(q.lang)
    const rows = await app.prisma.feedItem.findMany({
      where,
      orderBy: [{ pinned: 'desc' }, { publishedAt: 'desc' }, { createdAt: 'desc' }],
      take: limit + 1,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    })
    const hasMore = rows.length > limit
    const items = hasMore ? rows.slice(0, limit) : rows
    return { items, nextCursor: hasMore ? items[items.length - 1].id : null }
  })

  // ─── PUBLIC: single published item ───
  app.get('/:id', async (req, reply) => {
    const { id } = req.params as any
    const item = await app.prisma.feedItem.findFirst({ where: { id, status: 'published' } })
    if (!item) return reply.code(404).send({ error: 'not_found' })
    return item
  })
}
