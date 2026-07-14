'use client'

// Legacy — no longer used. Auth flow is now handled by individual pages.
export default function AuthGate({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
