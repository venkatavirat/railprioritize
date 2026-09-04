import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import './globals.css'

// Fonts are deliberately NOT loaded through next/font/google.
//
// That loader fetches the font files at compile time, and when the fetch
// fails Turbopack cannot resolve the generated module -- which takes down
// app/layout.tsx and therefore every route in the app with a 500, including
// the login page. Trading exact typography for a site that always boots is
// the right way round; the stacks in globals.css cover both variables.

export const metadata: Metadata = {
  title: 'RailPrioritize | Indian Railways Operations',
  description: 'Risk-aware maintenance prioritization for Indian Railways operations teams.',
  generator: 'v0.app',
  icons: {
    icon: [
      {
        url: '/icon-light-32x32.png',
        media: '(prefers-color-scheme: light)',
      },
      {
        url: '/icon-dark-32x32.png',
        media: '(prefers-color-scheme: dark)',
      },
      {
        url: '/icon.svg',
        type: 'image/svg+xml',
      },
    ],
    apple: '/apple-icon.png',
  },
}

export const viewport: Viewport = {
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: 'white' },
    { media: '(prefers-color-scheme: dark)', color: 'black' },
  ],
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
