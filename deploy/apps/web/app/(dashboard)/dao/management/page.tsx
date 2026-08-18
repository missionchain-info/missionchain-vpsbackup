'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/*
 * Governance now lives on one page.
 *
 * This was a placeholder describing what DAOGovernor would eventually do, alongside a
 * separate council page that already did the real work — three URLs for one activity, and a
 * member had to guess which one held the proposal they were looking for. Kept as a redirect
 * so existing links and bookmarks still land somewhere useful.
 */
export default function DaoManagementRedirect() {
  const router = useRouter()
  useEffect(() => { router.replace('/dao/council') }, [router])
  return null
}
