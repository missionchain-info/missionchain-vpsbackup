'use client'

import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="screen screen-welcome">
      <div className="welcome-card">
        <h1>Page Not Found</h1>
        <p>The page you are looking for does not exist.</p>
        <Link href="/" className="btn btn-primary" style={{ marginTop: 20 }}>
          Back to Home
        </Link>
      </div>
    </div>
  )
}
