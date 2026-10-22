/**
 * Tells the owner that someone used the service, through ntfy.sh (no storage).
 * Sends the kind of use and a rough location from Vercel's headers. Never the IP, the CV
 * or the vacancy. A failure here must not affect the request, so it never throws.
 *
 * Delivery is a push to the topic (ntfy app or ntfy.sh/<topic>). ntfy.sh only sends e-mail
 * for authenticated publishers, so the Email header is used only when NTFY_TOKEN is set.
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

  const token = process.env.NTFY_TOKEN
  const email = token ? process.env.NTFY_EMAIL : undefined
  try {
    const res = await fetch(`https://ntfy.sh/${encodeURIComponent(topic)}`, {
      method: 'POST',
      headers: {
        Title: TITLES[kind],
        Tags: 'bust_in_silhouette',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(email ? { Email: email } : {}),
      },
      body: [place(headers), detail].filter(Boolean).join(' | '),
      signal: AbortSignal.timeout(3000),
    })
    if (!res.ok) console.warn(`[notify] ntfy answered HTTP ${res.status}`)
  } catch {
    console.warn('[notify] could not send the usage notification')
  }
}
