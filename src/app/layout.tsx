import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Practica tu entrevista con IA',
  description: 'Entrevista simulada con IA sobre tu CV y la vacante, evaluada con el método STAR, y stress test de CV con varios reclutadores.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  )
}
