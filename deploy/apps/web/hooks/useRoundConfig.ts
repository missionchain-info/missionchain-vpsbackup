'use client'

import { useApi } from './useApi'

export type RoundStatus = 'UPCOMING' | 'ACTIVE' | 'CLOSED'

export interface RoundConfig {
  roundType: string
  status: RoundStatus
  displayCap?: string | null
  totalSold?: string
  countdownStart?: string | null
  countdownEnd?: string | null
  micPrice?: string | null
}

interface RoundsApiResponse {
  data?: RoundConfig[]
}

export function useRoundConfig() {
  const { data, loading, error, refetch } = useApi<RoundsApiResponse>('/rounds/config')

  const rounds: Record<string, RoundConfig> = {}
  if (data?.data) {
    for (const r of data.data) {
      rounds[r.roundType] = r
    }
  }

  const getRoundStatus = (roundId: string): RoundStatus => {
    const round = rounds[roundId]
    if (!round) return 'UPCOMING'
    return round.status as RoundStatus
  }

  const getRoundConfig = (roundId: string): RoundConfig | null => {
    return rounds[roundId] || null
  }

  return {
    rounds,
    loading,
    error,
    refetch,
    getRoundStatus,
    getRoundConfig,
  }
}

export default useRoundConfig
