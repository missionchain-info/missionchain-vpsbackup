'use client'

import { useAccount, useSignMessage } from 'wagmi'
import { useState, useEffect, useCallback } from 'react'
import { authApi } from '@/lib/api'

interface User {
  id: string
  userId: string
  wallet: string
}

interface AuthState {
  user: User | null
  jwt: string | null
  isRegistered: boolean
  isLoading: boolean
}

export function useAuth() {
  const { address, isConnected } = useAccount()
  const { signMessageAsync } = useSignMessage()
  const [auth, setAuth] = useState<AuthState>({
    user: null,
    jwt: null,
    isRegistered: false,
    isLoading: false,
  })

  // Check if wallet is registered on connect + restore JWT from localStorage
  useEffect(() => {
    if (!address) {
      localStorage.removeItem('mc-jwt')
      setAuth({ user: null, jwt: null, isRegistered: false, isLoading: false })
      return
    }

    const checkRegistration = async () => {
      setAuth((prev) => ({ ...prev, isLoading: true }))
      try {
        const { nonce } = await authApi.getNonce(address)
        const storedJwt = localStorage.getItem('mc-jwt')
        setAuth((prev) => ({
          ...prev,
          isRegistered: !!nonce,
          jwt: storedJwt,
          isLoading: false,
        }))
      } catch {
        setAuth((prev) => ({ ...prev, isRegistered: false, isLoading: false }))
      }
    }
    checkRegistration()
  }, [address])

  const register = useCallback(
    async (userId: string, referrer?: string) => {
      if (!address) throw new Error('Wallet not connected')

      setAuth((prev) => ({ ...prev, isLoading: true }))
      try {
        // 1. Register
        const { nonce } = await authApi.register({
          wallet: address,
          userId,
          referrer,
          termsAccepted: true,
        })

        // 2. Sign nonce
        const signature = await signMessageAsync({
          message: `Mission Chain Authentication\nNonce: ${nonce}`,
        })

        // 3. Verify signature → JWT
        const { jwt, user } = await authApi.verify({ wallet: address, signature })
        localStorage.setItem('mc-jwt', jwt)
        localStorage.setItem('mc-userId', user.userId)
        localStorage.setItem('mc-wallet', user.wallet)
        setAuth({ user, jwt, isRegistered: true, isLoading: false })
        return { jwt, user }
      } catch (err) {
        setAuth((prev) => ({ ...prev, isLoading: false }))
        throw err
      }
    },
    [address, signMessageAsync]
  )

  const signIn = useCallback(async () => {
    if (!address) throw new Error('Wallet not connected')

    setAuth((prev) => ({ ...prev, isLoading: true }))
    try {
      const { nonce } = await authApi.getNonce(address)
      const signature = await signMessageAsync({
        message: `Mission Chain Authentication\nNonce: ${nonce}`,
      })
      const { jwt, user } = await authApi.verify({ wallet: address, signature })
      localStorage.setItem('mc-jwt', jwt)
      localStorage.setItem('mc-userId', user.userId)
      localStorage.setItem('mc-wallet', user.wallet)
      setAuth({ user, jwt, isRegistered: true, isLoading: false })
      return { jwt, user }
    } catch (err) {
      setAuth((prev) => ({ ...prev, isLoading: false }))
      throw err
    }
  }, [address, signMessageAsync])

  return {
    ...auth,
    address,
    isConnected,
    register,
    signIn,
  }
}
