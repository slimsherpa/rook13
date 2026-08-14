import type { Metadata, Viewport } from 'next'
import { Inter, Orbitron } from 'next/font/google'
import './globals.css'
import { AuthProvider } from '@/lib/contexts/AuthContext'

const inter = Inter({ subsets: ['latin'] })
const orbitron = Orbitron({ 
  subsets: ['latin'],
  weight: ['400', '700'],
  variable: '--font-orbitron',
})

export const metadata: Metadata = {
  title: 'Rook13',
  description: 'A modern implementation of the classic trick-taking card game',
}

// mobile: paint the browser chrome navy to match the app, and extend into
// the safe areas (the table already pads with env(safe-area-inset-bottom))
export const viewport: Viewport = {
  themeColor: '#1e3a8a',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    // suppressHydrationWarning: the icon-font gate script stamps a class on
    // <html> before React hydrates — expected, not a mismatch bug
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=block"
          rel="stylesheet"
        />
        {/* icon-font gate: until the Material Symbols file arrives, an icon
            renders as its ligature *name* ("raven") in the fallback font.
            globals.css keeps the glyphs invisible until this adds .msym-ready
            — polling because fonts.check() is false while the @font-face rule
            itself is still downloading. 3s cap = today's behavior, worst case. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var t0=Date.now();function ok(){document.documentElement.classList.add('msym-ready')}function poll(){try{if(document.fonts.check("24px 'Material Symbols Outlined'"))return ok();if(Date.now()-t0>3000)return ok();document.fonts.load("24px 'Material Symbols Outlined'");setTimeout(poll,80)}catch(e){ok()}}poll()})();`,
          }}
        />
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
      </head>
      <body className={`${inter.className} ${orbitron.variable}`}>
        <AuthProvider>
          {children}
        </AuthProvider>
      </body>
    </html>
  )
}
