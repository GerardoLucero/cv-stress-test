import type { InterviewerPersona } from '@/sdk/types'

const SKIN = ['#f1c9a5', '#e0a982', '#c68863', '#a56b47', '#7a4a2e']
const HAIR = ['#1f1a17', '#3b2a1f', '#6b4a2f', '#a07a4b', '#8a8d91']
const SHIRT = ['#3b5b8c', '#2f6f6a', '#6a4c93', '#8c4a4a', '#46515e']
const BG = ['#dbe7f5', '#dcefe9', '#e6e0f2', '#f2e2e2', '#e3e7ec']

function hash(text: string): number {
  let h = 0
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return h
}

/** Simulated portrait: drawn from the persona's name and gender, no photo and no external service. */
export function PersonaAvatar({
  persona,
  size = 44,
}: {
  persona: Pick<InterviewerPersona, 'name' | 'voiceConfig'>
  size?: number
}) {
  const h = hash(persona.name)
  const skin = SKIN[h % SKIN.length]
  const hair = HAIR[(h >>> 3) % HAIR.length]
  const shirt = SHIRT[(h >>> 6) % SHIRT.length]
  const bg = BG[(h >>> 9) % BG.length]
  const gender = persona.voiceConfig?.gender ?? 'neutral'
  const long = gender === 'female' || (gender === 'neutral' && h % 2 === 0)

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="img"
      aria-label={`Retrato simulado de ${persona.name}`}
      style={{ borderRadius: '50%', flexShrink: 0 }}
    >
      <rect width="64" height="64" fill={bg} />
      {long && <path d="M18 30c0-14 6-20 14-20s14 6 14 20v16H18z" fill={hair} />}
      <path d="M8 64c0-13 10-20 24-20s24 7 24 20z" fill={shirt} />
      <rect x="28" y="36" width="8" height="10" rx="3" fill={skin} />
      <ellipse cx="32" cy="29" rx="10" ry="12" fill={skin} />
      <path
        d={long ? 'M21 28c0-9 5-14 11-14s11 5 11 14c-3-5-7-7-11-7s-8 2-11 7z' : 'M22 27c0-8 4-13 10-13s10 5 10 13c-2-4-6-6-10-6s-8 2-10 6z'}
        fill={hair}
      />
    </svg>
  )
}
