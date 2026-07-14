/**
 * xlsxBuilder — Reusable Excel (.xlsx) generator for admin + member exports.
 *
 * Usage:
 *   const buf = await buildXlsx({
 *     sheetName: 'Members',
 *     columns: [
 *       { header: 'User ID', key: 'userId', width: 20 },
 *       { header: 'Wallet',  key: 'wallet', width: 44 },
 *       { header: 'Joined',  key: 'createdAt', width: 16, format: 'datetime' },
 *     ],
 *     rows: users,
 *   })
 *   reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
 *   reply.header('Content-Disposition', `attachment; filename="${filename}"`)
 *   reply.send(buf)
 *
 * Styling defaults (Standard tier — agreed in brainstorm 2026-05-10):
 *   - Bold header in MissionChain gold (#B8860B), white text
 *   - Frozen top row
 *   - Auto-width per column (or fixed via `width` option)
 *   - Date/datetime cells formatted natively
 *   - Currency cells formatted with $
 */
import ExcelJS from 'exceljs'

export type ColumnFormat = 'text' | 'number' | 'datetime' | 'date' | 'currency-usd' | 'percent-bps'

export interface ColumnSpec<Row = Record<string, unknown>> {
  /** Column header label shown in row 1. */
  header: string
  /** Property key on each row (or function returning the cell value). */
  key: keyof Row | ((row: Row) => unknown)
  /** Column width (chars). Default = auto-fit based on header length. */
  width?: number
  /** Cell formatting hint. Default = 'text'. */
  format?: ColumnFormat
}

export interface BuildXlsxOptions<Row = Record<string, unknown>> {
  sheetName: string
  columns: ColumnSpec<Row>[]
  rows: Row[]
}

const HEADER_FILL_GOLD = 'FFB8860B'   // ARGB — MissionChain brand gold
const HEADER_FONT_WHITE = 'FFFFFFFF'

export async function buildXlsx<Row extends Record<string, unknown>>(
  opts: BuildXlsxOptions<Row>,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'MissionChain Admin'
  wb.created = new Date()

  const ws = wb.addWorksheet(opts.sheetName, {
    views: [{ state: 'frozen', ySplit: 1 }],
  })

  // ── Header row ──────────────────────────────────────────────────────
  ws.columns = opts.columns.map((c) => ({
    header: c.header,
    key: typeof c.key === 'string' ? c.key : c.header,
    width: c.width ?? Math.max(c.header.length + 2, 12),
  }))

  const headerRow = ws.getRow(1)
  headerRow.font = { bold: true, color: { argb: HEADER_FONT_WHITE }, size: 11 }
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: HEADER_FILL_GOLD },
  }
  headerRow.alignment = { vertical: 'middle', horizontal: 'left' }
  headerRow.height = 22

  // ── Data rows ───────────────────────────────────────────────────────
  for (const row of opts.rows) {
    const rowValues: Record<string, unknown> = {}
    opts.columns.forEach((c, idx) => {
      const colKey = typeof c.key === 'string' ? (c.key as string) : c.header
      const raw = typeof c.key === 'function' ? c.key(row) : row[c.key as keyof Row]
      rowValues[colKey] = formatCellValue(raw, c.format)
      // Save the format hint on the column for later cell formatting
      const wsCol = ws.getColumn(idx + 1)
      if (c.format && !wsCol.numFmt) {
        wsCol.numFmt = numFmtFor(c.format)
      }
    })
    ws.addRow(rowValues)
  }

  // ── Auto-fit columns when no explicit width ─────────────────────────
  opts.columns.forEach((c, idx) => {
    if (c.width != null) return
    const colNum = idx + 1
    let maxLen = c.header.length
    ws.getColumn(colNum).eachCell?.({ includeEmpty: false }, (cell) => {
      const v = cell.value
      const len = v == null ? 0 : String(v).length
      if (len > maxLen) maxLen = len
    })
    ws.getColumn(colNum).width = Math.min(Math.max(maxLen + 2, 10), 60)
  })

  const buffer = await wb.xlsx.writeBuffer()
  return Buffer.from(buffer)
}

// ── Helpers ───────────────────────────────────────────────────────────

function formatCellValue(raw: unknown, fmt?: ColumnFormat): unknown {
  if (raw == null) return ''
  switch (fmt) {
    case 'datetime':
    case 'date':
      // Pass Date through; Excel renders via numFmt
      if (raw instanceof Date) return raw
      // accept ISO strings
      if (typeof raw === 'string') {
        const d = new Date(raw)
        return isNaN(d.getTime()) ? raw : d
      }
      return raw
    case 'number':
      return typeof raw === 'bigint' ? Number(raw) : Number(raw)
    case 'currency-usd':
      return typeof raw === 'bigint' ? Number(raw) : Number(raw)
    case 'percent-bps':
      // bps → fraction (500 → 0.05); Excel renders as 5.00%
      return typeof raw === 'number' ? raw / 10_000 : raw
    case 'text':
    default:
      // Convert bigint to string for safety; Excel cells don't support BigInt
      if (typeof raw === 'bigint') return raw.toString()
      return raw
  }
}

function numFmtFor(fmt: ColumnFormat): string | undefined {
  switch (fmt) {
    case 'datetime':     return 'yyyy-mm-dd hh:mm'
    case 'date':         return 'yyyy-mm-dd'
    case 'currency-usd': return '"$"#,##0.00'
    case 'percent-bps':  return '0.00%'
    case 'number':       return '#,##0'
    default:             return undefined
  }
}

/**
 * Build a sortable timestamp suffix for filenames: "2026-05-10-1430".
 * Local server time. Use for `attachment; filename="members-${suffix}.xlsx"`.
 */
export function fileTimestamp(now: Date = new Date()): string {
  const yyyy = now.getFullYear()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  const hh = String(now.getHours()).padStart(2, '0')
  const mi = String(now.getMinutes()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}-${hh}${mi}`
}
