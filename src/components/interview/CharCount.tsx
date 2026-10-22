export function CharCount({ value, max }: { value: string; max: number }) {
  const near = value.length >= max * 0.9
  return (
    <span
      aria-live="polite"
      style={{ fontSize: '0.75rem', color: near ? 'var(--red)' : 'var(--text-muted)', textAlign: 'right' }}
    >
      {value.length.toLocaleString('es-MX')} / {max.toLocaleString('es-MX')} caracteres
    </span>
  )
}
