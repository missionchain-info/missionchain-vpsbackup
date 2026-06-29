'use client'

import styles from './MfpCard.module.css'

const MFP_THUMB_BASE = 'https://api.missionchain.io/static/mfp-art/thumb/'
const MFP_FULL_BASE = 'https://api.missionchain.io/static/mfp-art/'
const MFP_SERIES = 'MISSION FOUNDING PASS'

export interface MfpCardProps {
  /** Token serial number (e.g. 1, 2, 25, 100, 2500). Padded to 4 digits. */
  tokenId: number
  /** Image #1..100 — picked by Fisher-Yates random pair on-chain */
  imageId: number
  /** Verse #1..100 — picked by Fisher-Yates random pair on-chain */
  verseId: number
  /** Card title (from verse pool, e.g. "Dove of Genesis") */
  title?: string
  /** Italic descriptive line under title */
  soulLine?: string
  /** Bible verse text (without quote marks) */
  verseText?: string
  /** Bible verse reference (e.g. "Genesis 1:2") */
  verseRef?: string
  /** Use thumbnail URL (600×600) instead of full (3000×3000). Default: true */
  thumbnail?: boolean
  /** Compact size variant for grid view */
  compact?: boolean
  /** Year shown in footer. Default: current year */
  year?: number
}

function pad4(n: number): string {
  return n.toString().padStart(4, '0')
}

function pad3(n: number): string {
  return n.toString().padStart(3, '0')
}

export default function MfpCard({
  tokenId,
  imageId,
  verseId,
  title,
  soulLine,
  verseText,
  verseRef,
  thumbnail = true,
  compact = false,
  year = new Date().getFullYear(),
}: MfpCardProps) {
  const imageUrl = (thumbnail ? MFP_THUMB_BASE : MFP_FULL_BASE) + `MFP-ART-${pad3(imageId)}.png`
  const cardClasses = `${styles.card} ${compact ? styles.compact : ''}`.trim()

  return (
    <div className={cardClasses}>
      <div className={styles.patternBg} />
      <div className={styles.geoWatermark} />

      <div className={styles.header}>
        <div className={styles.brand}>MISSION CHAIN</div>
        <div className={styles.serial}>
          MFP #{pad4(tokenId)}<span className={styles.serialDot}>·</span>{MFP_SERIES}
        </div>
      </div>

      <div className={styles.imageWrap}>
        <img
          src={imageUrl}
          alt={title || `MFP #${pad4(tokenId)}`}
          loading="lazy"
          onError={(e) => {
            // Fallback to ✦ placeholder if image fails to load
            const img = e.currentTarget
            img.style.display = 'none'
            const placeholder = img.parentElement?.querySelector(`.${styles.imagePlaceholder}`) as HTMLElement | null
            if (placeholder) placeholder.style.display = 'flex'
          }}
        />
        <div className={styles.imagePlaceholder} style={{ display: 'none' }}>✦</div>
      </div>

      <div className={styles.divider}>
        <div className={styles.dividerLine} />
        <span className={styles.dividerStar}>✦</span>
        <div className={styles.dividerLine} />
      </div>

      {title && (
        <div className={styles.title}>&ldquo;{title}&rdquo;</div>
      )}

      {soulLine && (
        <div className={styles.soul}>{soulLine}</div>
      )}

      <div className={styles.miniDivider} />

      {verseText && (
        <div className={styles.verse}>
          &ldquo;{verseText}&rdquo;
          {verseRef && <span className={styles.verseRef}>— {verseRef}</span>}
        </div>
      )}

      <div className={styles.footer}>
        missionchain.io <span className={styles.footerStar}>✦</span> {year}
      </div>
    </div>
  )
}
