/**
 * Tells the owner that someone used the service, through ntfy.sh (no account, no storage).
 * Sends the kind of use and a rough location from Vercel's headers. Never the IP, the CV
 * or the vacancy. A failure here must not affect the request, so it never throws.
 */
export type UseKind = 'interview' | 'stress-test'

const TITLES: Record<UseKind, string> = {
  interview: 'Nueva entrevista simulada',
  'stress-test': 'Nuevo stress test de CV',
}

function place(headers: Headers): string {
  const decode = (v: string | null) => {
    try {
      return v ? decodeURIComponent(v) : ''
    } catch {
      return ''
    }
  }
  const parts = [decode(headers.get('x-vercel-ip-city')), headers.get('x-vercel-ip-country') ?? ''].filter(Boolean)
  return parts.length ? parts.join(', ') : 'ubicación desconocida'
}

export async function notifyUse(kind: UseKind, headers: Headers, detail?: string): Promise<void> {
  const topic = process.env.NTFY_TOPIC
  if (!topic) return

  const email = process.env.NTFY_EMAIL
  try {
    await fetch(`https://ntfy.sh/${encodeURIComponent(topic)}`, {
      method: 'POST',
      headers: {
        Title: TITLES[kind],
        Tags: 'bust_in_silhouette',
        ...(email ? { Email: email } : {}),
      },
      body: [place(headers), detail].filter(Boolean).join(' | '),
      signal: AbortSignal.timeout(3000),
    })
  } catch {
    console.warn('[notify] could not send the usage notification')
  }
}
