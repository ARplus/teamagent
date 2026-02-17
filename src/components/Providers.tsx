'use client'

import { SessionProvider } from 'next-auth/react'
import { EventToastWrapper } from './EventToastWrapper'

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      {children}
      <EventToastWrapper />
    </SessionProvider>
  )
}
