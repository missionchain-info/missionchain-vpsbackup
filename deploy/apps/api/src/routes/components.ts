import { FastifyPluginAsync } from "fastify"
import crypto from "crypto"

/**
 * Components API — serves real data for Admin Components page
 * Prefix: /components
 */
export const componentsRoutes: FastifyPluginAsync = async (app) => {

  // ═══════════════════════════════════════════════════════════════
  // MFP-NFT Stats (public — no auth needed for read)
  // ═══════════════════════════════════════════════════════════════
  app.get("/mfp/stats", async () => {
    const [totalMinted, totalActive] = await Promise.all([
      app.prisma.nFTItem.count({ where: { contractType: "MFP" } }),
      app.prisma.nFTItem.count({ where: { contractType: "MFP", active: true } }),
    ])
    return {
      maxSupply: 2500,
      minted: totalMinted,
      active: totalActive,
      available: Math.max(0, 2500 - totalMinted),
    }
  })

  // ═══════════════════════════════════════════════════════════════
  // Community NFT Stats — per tier
  // ═══════════════════════════════════════════════════════════════
  app.get("/community/stats", async () => {
    const tiers = ["Builder", "Maker", "Luminary"]
    const now = new Date()
    const results = await Promise.all(
      tiers.map(async (tier) => {
        const [total, active, expired] = await Promise.all([
          app.prisma.nFTItem.count({ where: { contractType: "COMMUNITY", tier } }),
          app.prisma.nFTItem.count({
            where: { contractType: "COMMUNITY", tier, active: true, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
          }),
          app.prisma.nFTItem.count({
            where: { contractType: "COMMUNITY", tier, OR: [{ active: false }, { expiresAt: { lte: now } }] },
          }),
        ])
        return { tier, minted: total, active, expired }
      })
    )
    return { tiers: results }
  })

  // ═══════════════════════════════════════════════════════════════
  // MICE Stats
  // ═══════════════════════════════════════════════════════════════
  app.get("/mice/stats", async () => {
    const [totalPurchases, activeLicenses] = await Promise.all([
      app.prisma.$queryRawUnsafe(
        `SELECT count(*)::int as total FROM "Purchase" WHERE type = 'MICE'`
      ) as Promise<[{ total: number }]>,
      app.prisma.$queryRawUnsafe(
        `SELECT count(*)::int as active FROM "Purchase" WHERE type = 'MICE' AND "createdAt" > NOW() - INTERVAL '360 days'`
      ) as Promise<[{ active: number }]>,
    ])
    const total = totalPurchases[0]?.total ?? 0
    const active = activeLicenses[0]?.active ?? 0
    return {
      totalCap: 100000,
      sold: total,
      active: active,
      expired: Math.max(0, total - active),
    }
  })

  // ═══════════════════════════════════════════════════════════════
  // Artwork — MFP
  // ═══════════════════════════════════════════════════════════════
  app.get("/artwork/mfp", async () => {
    const items = await app.prisma.mfpArtwork.findMany({
      where: { active: true },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, usedCount: true, createdAt: true },
    })
    return { type: "MFP", items, count: items.length }
  })

  app.post("/artwork/mfp", {
    preHandler: [app.authenticate],
  }, async (req, reply) => {
    const { name, imageData } = req.body as { name: string; imageData: string }
    if (!name || !imageData) return reply.status(400).send({ error: "name and imageData required" })
    const item = await app.prisma.mfpArtwork.create({
      data: { id: crypto.randomUUID(), name, imageData, active: true, usedCount: 0 },
    })
    return { id: item.id, name: item.name }
  })

  app.delete("/artwork/mfp/:id", {
    preHandler: [app.authenticate],
  }, async (req, reply) => {
    const { id } = req.params as { id: string }
    await app.prisma.mfpArtwork.update({ where: { id }, data: { active: false } })
    return { success: true }
  })

  // ═══════════════════════════════════════════════════════════════
  // Artwork — Community (Builder/Maker/Luminary)
  // ═══════════════════════════════════════════════════════════════
  app.get("/artwork/community/:tier", async (req) => {
    const { tier } = req.params as { tier: string }
    const items = await app.prisma.$queryRawUnsafe(
      `SELECT id, name, "usedCount", "createdAt" FROM "CommunityArtwork" WHERE tier = $1 AND active = true ORDER BY "createdAt" DESC`,
      tier
    ) as any[]
    return { type: tier, items, count: items.length }
  })

  app.post("/artwork/community", {
    preHandler: [app.authenticate],
  }, async (req, reply) => {
    const { tier, name, imageData } = req.body as { tier: string; name: string; imageData: string }
    if (!tier || !name || !imageData) return reply.status(400).send({ error: "tier, name, imageData required" })
    if (!["Builder", "Maker", "Luminary"].includes(tier)) return reply.status(400).send({ error: "Invalid tier" })
    const id = crypto.randomUUID()
    await app.prisma.$executeRawUnsafe(
      `INSERT INTO "CommunityArtwork" (id, tier, name, "imageData", active, "usedCount", "createdAt") VALUES ($1, $2, $3, $4, true, 0, NOW())`,
      id, tier, name, imageData
    )
    return { id, tier, name }
  })

  app.delete("/artwork/community/:id", {
    preHandler: [app.authenticate],
  }, async (req) => {
    const { id } = req.params as { id: string }
    await app.prisma.$executeRawUnsafe(
      `UPDATE "CommunityArtwork" SET active = false WHERE id = $1`, id
    )
    return { success: true }
  })

  // ═══════════════════════════════════════════════════════════════
  // Team Allocation CRUD
  // ═══════════════════════════════════════════════════════════════
  app.get("/allocations", async () => {
    const items = await app.prisma.$queryRawUnsafe(
      `SELECT * FROM "TeamAllocation" ORDER BY "createdAt" ASC`
    ) as any[]
    const totalMic = items.reduce((s: number, a: any) => s + Number(a.micAmount), 0)
    const totalMfp = items.reduce((s: number, a: any) => s + Number(a.mfpQuantity), 0)
    return {
      items,
      summary: {
        totalPool: 280000000,
        allocated: totalMic,
        remaining: 280000000 - totalMic,
        mfpAllocated: totalMfp,
      },
    }
  })

  app.post("/allocations", {
    preHandler: [app.authenticate],
  }, async (req, reply) => {
    const { name, role, wallet, micAmount, mfpQuantity } = req.body as any
    if (!name || !role) return reply.status(400).send({ error: "name and role required" })
    const id = crypto.randomUUID()
    await app.prisma.$executeRawUnsafe(
      `INSERT INTO "TeamAllocation" (id, name, role, wallet, "micAmount", "mfpQuantity", status, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, draft, NOW(), NOW())`,
      id, name, role, wallet || "0x...pending", Number(micAmount) || 0, Number(mfpQuantity) || 0
    )
    return { id, status: "draft" }
  })

  app.patch("/allocations/:id", {
    preHandler: [app.authenticate],
  }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const { status, wallet, micAmount, mfpQuantity, mintTxHash } = req.body as any
    const sets: string[] = []
    const vals: any[] = []
    let idx = 1
    if (status) { sets.push(`status = $${idx++}`); vals.push(status) }
    if (wallet) { sets.push(`wallet = $${idx++}`); vals.push(wallet) }
    if (micAmount !== undefined) { sets.push(`"micAmount" = $${idx++}`); vals.push(Number(micAmount)) }
    if (mfpQuantity !== undefined) { sets.push(`"mfpQuantity" = $${idx++}`); vals.push(Number(mfpQuantity)) }
    if (mintTxHash) { sets.push(`"mintTxHash" = $${idx++}`); vals.push(mintTxHash) }
    if (sets.length === 0) return reply.status(400).send({ error: "No fields to update" })
    sets.push(`"updatedAt" = NOW()`)
    vals.push(id)
    await app.prisma.$executeRawUnsafe(
      `UPDATE "TeamAllocation" SET ${sets.join(", ")} WHERE id = $${idx}`,
      ...vals
    )
    return { success: true }
  })

  app.delete("/allocations/:id", {
    preHandler: [app.authenticate],
  }, async (req) => {
    const { id } = req.params as { id: string }
    await app.prisma.$executeRawUnsafe(`DELETE FROM "TeamAllocation" WHERE id = $1 AND status != minted`, id)
    return { success: true }
  })
}
