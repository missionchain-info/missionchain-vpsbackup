'use client'

import { useState, useEffect, useCallback } from 'react'
import { api } from '@/lib/api'

interface UseApiOptions {
  enabled?: boolean
}

interface UseApiReturn<T> {
  data: T | null
  loading: boolean
  error: string | null
  refetch: () => void
}

export function useApi<T>(path: string, opts: UseApiOptions = {}): UseApiReturn<T> {
  const { enabled = true } = opts
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    if (!enabled) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const result = await api<T>(path)
      setData(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch')
    } finally {
      setLoading(false)
    }
  }, [path, enabled])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // Refetch when auth changes (Layer C — wallet switch triggers JWT refresh)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const handler = () => { fetchData() }
    window.addEventListener('mc-auth-changed', handler)
    return () => { window.removeEventListener('mc-auth-changed', handler) }
  }, [fetchData])

  return { data, loading, error, refetch: fetchData }
}

export default useApi
