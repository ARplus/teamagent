import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'TeamAgent - 团队协作新范式',
  description: 'Every team member gets an AI Agent. Collaboration reimagined.',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen bg-gray-50">
        <nav className="bg-white border-b border-gray-200 px-6 py-4">
          <div className="max-w-7xl mx-auto flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <span className="text-2xl">🤝</span>
              <h1 className="text-xl font-bold text-gray-900">TeamAgent</h1>
              <span className="text-xs bg-gradient-to-r from-orange-500 to-red-500 text-white px-2 py-0.5 rounded-full">Beta</span>
            </div>
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-2 bg-green-50 px-3 py-1.5 rounded-full">
                <span className="text-lg">🦞</span>
                <span className="text-sm font-medium text-green-700">Lobster 在线</span>
                <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
              </div>
              <div className="flex items-center space-x-2">
                <div className="w-8 h-8 bg-gradient-to-br from-purple-500 to-pink-500 rounded-full flex items-center justify-center text-white text-sm font-bold">
                  A
                </div>
                <span className="text-sm font-medium text-gray-700">Aurora</span>
              </div>
            </div>
          </div>
        </nav>
        <main className="max-w-7xl mx-auto px-6 py-8">
          {children}
        </main>
      </body>
    </html>
  )
}
