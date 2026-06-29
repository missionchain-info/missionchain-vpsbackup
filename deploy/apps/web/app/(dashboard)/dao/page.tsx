'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

// Redirect /dao → /dao/council (Steward Council is the default landing)
export default function DaoIndex() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/dao/council')
  }, [router])
  return null
}
