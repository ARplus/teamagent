'use client'

import { Suspense, useEffect, useState } from 'react'
import { MobileBottomNav } from './MobileBottomNav'

export function MobileBottomNavMount() {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) return null
  return (
    <Suspense fallback={null}>
      <MobileBottomNav />
    </Suspense>
  )
}
