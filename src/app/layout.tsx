import type { Metadata } from 'next'
import './globals.css'
import { Providers } from '@/components/Providers'
import { MobileBottomNavMount } from '@/components/MobileBottomNavMount'

export const metadata: Metadata = {
  title: 'TeamAgent - 团队协作新范式',
  description: 'Every team member gets an AI Agent. Collaboration reimagined.',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'TeamAgent',
  },
  viewport: {
    width: 'device-width',
    initialScale: 1,
    maximumScale: 1,
    userScalable: false,
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="zh-CN">
      <head>
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#f97316" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="TeamAgent" />
        <link rel="apple-touch-icon" href="/icon-192.png" />
      </head>
      <body className="min-h-screen bg-gray-50">
        <Providers>
          {children}
          <MobileBottomNavMount />
        </Providers>
      </body>
    </html>
  )
}
