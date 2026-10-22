'use client'

import { useEffect, useState } from 'react'
import { CharCount } from '@/components/interview/CharCount'
import { LIMITS } from '@/sdk/limits'
import { PersonaSelector } from '@/components/interview/PersonaSelector'
import { LiveInterviewRoom } from '@/components/interview/LiveInterviewRoom'
import { ScorecardView } from '@/components/interview/ScorecardView'
import { PRESET_PERSONAS } from '@/sdk/personas'
import { InterviewerPersona, InterviewSession } from '@/sdk/types'

interface HiringManagerProfile {
  name: string; role: string; company: string; yearsHiring: number; bias: string
}
interface ManagerReaction {
  index: number; profile: HiringManagerProfile; wouldAdvance: boolean
  reaction: string; concerns: string[]; positives: string[]
  tokens: number; durationMs: number; error?: string
}
interface SuggestedRole { role: string; fit: number; reason: string }
interface CourseRecommendation {
  skill: string; platform: string; course: string; why: string
  priority: 'high' | 'medium' | 'low'
}
interface AnalysisResult {
  advanceRate: number
  sentimentBreakdown: { strong_yes: number; lean_yes: number; lean_no: number; strong_no: number }
  topStrengths: string[]; topConcerns: string[]; keyChanges: string[]
  suggestedRoles: SuggestedRole[]
  cvAdjustments: Array<{ section: string; action: string }>
  courseRecommendations: CourseRecommendation[]
  verdict: string; oneLiner: string
}

const PRIORITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 }
const PRIORITY_COLOR: Record<string, string> = {
  high: 'var(--red)', medium: 'var(--accent)', low: 'var(--text-muted)'
}
const PRIORITY_LABEL: Record<string, string> = {
  high: 'Alta prioridad', medium: 'Media', low: 'Complementario'
}

function FitBar({ fit }: { fit: number }) {
  const color = fit >= 75 ? 'var(--green)' : fit >= 50 ? 'var(--primary-light)' : 'var(--accent)'
  return (
    <div className="fit-bar-wrap">
      <div className="fit-bar-bg">
        <div className="fit-bar-fill" style={{ width: `${fit}%`, background: color }} />
      </div>
      <span className="fit-pct" style={{ color }}>{fit}%</span>
    </div>
  )
}

export default function Home() {
  const [cv, setCv] = useState('')
  const [jobDescription, setJobDescription] = useState('')
  const [n, setN] = useState(5)
  const [loading, setLoading] = useState(false)
  const [streamedManagers, setStreamedManagers] = useState<ManagerReaction[]>([])
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [totalTokens, setTotalTokens] = useState(0)
  const [durationMs, setDurationMs] = useState(0)
  const [warning, setWarning] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [runCount, setRunCount] = useState(0)

  // ─── Live Interview State ───────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<'interview' | 'stress-test'>('interview')
  const [selectedPersona, setSelectedPersona] = useState<InterviewerPersona | null>(null)
  const [targetRole, setTargetRole] = useState('')
  const [totalQuestions, setTotalQuestions] = useState(4)
  const [interviewSession, setInterviewSession] = useState<InterviewSession | null>(null)
  const [interviewToken, setInterviewToken] = useState('')
  const [interviewLoading, setInterviewLoading] = useState(false)
  const [interviewError, setInterviewError] = useState<string | null>(null)
  const [generatedPersonas, setGeneratedPersonas] = useState<InterviewerPersona[]>([])
  const [personasLoading, setPersonasLoading] = useState(false)
  const [personasError, setPersonasError] = useState<string | null>(null)
  // The presets are generic engineering profiles: they only appear when generation fails.
  const [showPresets, setShowPresets] = useState(false)

  // Interviewers are tailored to the CV and vacancy, so editing either one invalidates them.
  useEffect(() => {
    setGeneratedPersonas((prev) => (prev.length ? [] : prev))
    setSelectedPersona(null)
  }, [cv, jobDescription])

  async function handleGeneratePersonas() {
    setPersonasLoading(true)
    setPersonasError(null)
    setShowPresets(false)
    try {
      const res = await fetch('/api/interview/personas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cv, jobDescription }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? 'No se pudieron generar entrevistadores.')
      setGeneratedPersonas(data.personas)
      setSelectedPersona(data.personas[0])
    } catch (err: any) {
      setPersonasError(err.message)
      setShowPresets(true)
    } finally {
      setPersonasLoading(false)
    }
  }

  async function handleStartInterview(e: React.FormEvent) {
    e.preventDefault()
    if (!cv.trim() || !jobDescription.trim()) {
      setInterviewError('Por favor introduce tu CV y la descripción del puesto.')
      return
    }
    if (!selectedPersona) {
      setInterviewError('Genera y elige un entrevistador para continuar.')
      return
    }
    setInterviewLoading(true)
    setInterviewError(null)

    try {
      const res = await fetch('/api/interview/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cv,
          jobDescription,
          targetRole: targetRole || undefined,
          ...(selectedPersona.id.startsWith('dyn-')
            ? { persona: selectedPersona }
            : { personaId: selectedPersona.id }),
          totalQuestions,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? 'Error al iniciar la entrevista')
      setInterviewSession(data.session)
      setInterviewToken(data.token)
    } catch (err: any) {
      setInterviewError(err.message)
    } finally {
      setInterviewLoading(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setStreamedManagers([])
    setProgress(null)
    setResult(null)
    setTotalTokens(0)
    setDurationMs(0)
    setWarning(null)
    setError(null)

    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cv, jobDescription, n }),
      })

      if (!res.ok) {
        const json = await res.json()
        throw new Error(json.error ?? 'Unknown error')
      }

      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const event = JSON.parse(line.slice(6))
            if (event.type === 'progress') {
              setProgress({ done: event.done, total: event.total })
              if (!event.manager.error && event.manager.reaction) {
                setStreamedManagers(prev => [...prev, event.manager])
              }
            } else if (event.type === 'complete') {
              setResult(event.result)
              setTotalTokens(event.totalTokens)
              setDurationMs(event.durationMs)
              if (event.warning) setWarning(event.warning)
              setRunCount(c => c + 1)
            } else if (event.type === 'error') {
              throw new Error(event.error)
            }
          } catch (parseErr) {
            if (parseErr instanceof SyntaxError) continue
            throw parseErr
          }
        }
      }
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
      setProgress(null)
    }
  }

  const hasResults = streamedManagers.length > 0 || result !== null
  const sortedRoles = [...(result?.suggestedRoles ?? [])].sort((a, b) => b.fit - a.fit)
  const sortedCourses = [...(result?.courseRecommendations ?? [])].sort(
    (a, b) => (PRIORITY_ORDER[a.priority] ?? 1) - (PRIORITY_ORDER[b.priority] ?? 1)
  )

  return (
    <main>
      <section className="hero no-print">
        <div className="container">
          <div className="hero-tag">
            <span className="badge">Voz o texto</span>
            <span className="badge">Sin registro</span>
            <span className="badge">Gratis y open source</span>
          </div>
          <h1>
            Simulador de <span className="gradient-text">entrevistas técnicas</span>
          </h1>
          <p className="hero-sub">
            Entrevistadores de IA adaptados a tu perfil y a la vacante evalúan tus respuestas y entregan un informe con recomendaciones concretas.
          </p>
          <p className="hero-sub2">
            Evaluación por competencias con el método STAR. Incluye un análisis de CV con varios reclutadores simulados.
          </p>
        </div>
      </section>

      {/* Tabs */}
      <div className="container no-print">
        <div className="main-tab-nav" role="tablist">
          <button
            role="tab"
            aria-selected={activeTab === 'interview'}
            onClick={() => setActiveTab('interview')}
            className={`tab-nav-btn ${activeTab === 'interview' ? 'active' : ''}`}
          >
            Entrevista simulada
          </button>
          <button
            role="tab"
            aria-selected={activeTab === 'stress-test'}
            onClick={() => setActiveTab('stress-test')}
            className={`tab-nav-btn ${activeTab === 'stress-test' ? 'active' : ''}`}
          >
            Stress test de CV
          </button>
        </div>
      </div>

      {activeTab === 'interview' ? (
        <div className="container">
          {interviewSession?.status === 'completed' && interviewSession.finalScorecard ? (
            <ScorecardView
              scorecard={interviewSession.finalScorecard}
              session={interviewSession}
              onRestart={() => setInterviewSession(null)}
            />
          ) : interviewSession ? (
            <LiveInterviewRoom
              initialSession={interviewSession}
              initialToken={interviewToken}
              onProgress={(updated, token) => {
                setInterviewSession(updated)
                setInterviewToken(token)
              }}
              onFinish={(updated) => setInterviewSession(updated)}
            />
          ) : (
            <section className="form-section no-print">
              <form onSubmit={handleStartInterview}>
                <h3 className="section-title">1. Pega tu CV y la vacante</h3>
                <div className="form-grid">
                  <div className="field">
                    <label htmlFor="iv-cv">Tu Currículum Vitae (CV)</label>
                    <textarea id="iv-cv"
                      value={cv}
                      onChange={(e) => setCv(e.target.value)}
                      placeholder="Pega aquí tu CV completo (experiencia, proyectos, logros y tecnologías)..."
                      rows={12}
                      maxLength={LIMITS.cv}
                      required
                    />
                    <CharCount value={cv} max={LIMITS.cv} />
                  </div>
                  <div className="field">
                    <label htmlFor="iv-jd">Descripción de la Vacante (Job Description)</label>
                    <textarea id="iv-jd"
                      value={jobDescription}
                      onChange={(e) => setJobDescription(e.target.value)}
                      placeholder="Pega aquí la vacante o rol al que aspiras para que la IA calibre la dificultad..."
                      rows={12}
                      maxLength={LIMITS.jobDescription}
                      required
                    />
                    <CharCount value={jobDescription} max={LIMITS.jobDescription} />
                  </div>
                </div>

                <div style={{ margin: '1.5rem 0' }}>
                  <h3 className="section-title">2. Elige a tu entrevistador</h3>
                  <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)', marginTop: '-0.75rem' }}>
                    Se generan según tu CV y la vacante, cada uno con un enfoque y nivel de exigencia distintos.
                  </p>
                  {generatedPersonas.length > 0 && (
                    <PersonaSelector
                      personas={generatedPersonas}
                      selectedId={selectedPersona?.id ?? ''}
                      onSelect={(p) => setSelectedPersona(p)}
                    />
                  )}
                  {showPresets && (
                    <>
                      <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                        Mientras tanto puedes usar un entrevistador genérico de perfil técnico:
                      </p>
                      <PersonaSelector
                        personas={Object.values(PRESET_PERSONAS)}
                        selectedId={selectedPersona?.id ?? ''}
                        onSelect={(p) => setSelectedPersona(p)}
                      />
                    </>
                  )}
                  <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="btn btn-outline"
                      onClick={handleGeneratePersonas}
                      disabled={personasLoading || cv.trim().length < 50 || jobDescription.trim().length < 20}
                    >
                      {personasLoading
                        ? 'Generando entrevistadores...'
                        : generatedPersonas.length
                          ? 'Generar otros entrevistadores'
                          : 'Generar entrevistadores'}
                    </button>
                    {(cv.trim().length < 50 || jobDescription.trim().length < 20) && !personasLoading && (
                      <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                        Completa primero tu CV y la vacante.
                      </span>
                    )}
                  </div>
                  {personasError && (
                    <div role="alert" style={{ color: 'var(--red)', marginTop: '0.5rem', fontSize: '0.85rem' }}>
                      {personasError}
                    </div>
                  )}
                </div>

                <div className="form-footer" style={{ marginTop: '1.25rem' }}>
                  <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                    <div className="n-selector">
                      <label>Preguntas: <strong>{totalQuestions}</strong></label>
                      <input
                        type="range"
                        min={2}
                        max={5}
                        value={totalQuestions}
                        onChange={(e) => setTotalQuestions(Number(e.target.value))}
                      />
                      <span className="n-hint">2 = Express · 5 = Completa</span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Rol / Especialidad (Opcional):</span>
                      <input
                        type="text"
                        value={targetRole}
                        onChange={(e) => setTargetRole(e.target.value)}
                        placeholder="Ej. Staff Backend, Tech Lead, SRE..."
                        style={{
                          background: 'var(--surface-light)',
                          border: '1px solid var(--border)',
                          borderRadius: '6px',
                          color: 'var(--text)',
                          padding: '0.4rem 0.75rem',
                          fontSize: '0.85rem',
                        }}
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={interviewLoading || !selectedPersona || !cv.trim() || !jobDescription.trim()}
                  >
                    {interviewLoading ? 'Preparando entrevista...' : selectedPersona ? `Iniciar entrevista con ${selectedPersona.name} →` : 'Elige un entrevistador'}
                  </button>
                </div>

                {interviewError && (
                  <div role="alert" style={{ color: 'var(--red)', marginTop: '1rem', fontSize: '0.9rem' }}>
                    {interviewError}
                  </div>
                )}
              </form>
            </section>
          )}
        </div>
      ) : (
        <>
          <section className="form-section no-print">
            <div className="container">
              <form onSubmit={handleSubmit}>
                <div className="form-grid">
                  <div className="field">
                    <label>Your CV</label>
                    <textarea value={cv} onChange={e => setCv(e.target.value)} placeholder="Paste your full CV here..." rows={14} maxLength={LIMITS.cv} required />
                    <CharCount value={cv} max={LIMITS.cv} />
                  </div>
                  <div className="field">
                    <label>Job Description</label>
                    <textarea value={jobDescription} onChange={e => setJobDescription(e.target.value)} placeholder="Paste the job description here..." rows={14} maxLength={LIMITS.jobDescription} required />
                    <CharCount value={jobDescription} max={LIMITS.jobDescription} />
                  </div>
                </div>
                <div className="form-footer">
                  <div className="n-selector">
                    <label>Reviewers: <strong>{n}</strong></label>
                    <input type="range" min={3} max={10} value={n} onChange={e => setN(Number(e.target.value))} />
                    <span className="n-hint">3 = fast · 10 = thorough</span>
                  </div>
                  <button type="submit" className="btn btn-primary" disabled={loading}>
                    {loading ? 'Simulating...' : 'Run Stress Test →'}
                  </button>
                </div>
              </form>
            </div>
          </section>

      {loading && (
        <div className="container loading-section no-print">
          <div className="card loading-card">
            {progress ? (
              <>
                <div style={{ width: '100%', background: 'var(--border)', borderRadius: '4px', height: '6px', overflow: 'hidden' }}>
                  <div style={{
                    width: `${Math.round((progress.done / progress.total) * 100)}%`,
                    height: '100%',
                    background: 'var(--primary)',
                    transition: 'width 0.3s ease',
                  }} />
                </div>
                <span>{progress.done}/{progress.total} managers evaluated…</span>
              </>
            ) : (
              <>
                <div className="spinner" />
                <span>Agent validating inputs and generating managers…</span>
              </>
            )}
          </div>
        </div>
      )}

      {error && (
        <div className="container no-print">
          <div className="card error-card">{error}</div>
        </div>
      )}

      {hasResults && (
        <section key={runCount} className="container results" id="report">

          <div className="print-header">
            <h1>CV Stress Test — Report</h1>
            <p className="print-meta">Generated on {new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
          </div>

          {result && (
            <div className="report-actions no-print">
              <button className="btn btn-outline" onClick={() => window.print()}>⤓ Download PDF</button>
            </div>
          )}

          {warning && (
            <div className="warning-card no-print">
              {warning}
            </div>
          )}

          {result && (
            <>
              <div className="summary-grid">
                <div className="card advance-card">
                  <div className="advance-rate">
                    <span className="rate-number">{result.advanceRate}%</span>
                    <span className="rate-label">would advance you</span>
                  </div>
                  <div className="rate-bar">
                    <div className="rate-fill" style={{ width: `${result.advanceRate}%` }} />
                  </div>
                </div>
                <div className="card verdict-card">
                  <h3 className="section-title">Verdict</h3>
                  <p className="verdict-text">{result.verdict}</p>
                  <p className="one-liner">&ldquo;{result.oneLiner}&rdquo;</p>
                </div>
              </div>

              {sortedRoles.length > 0 && (
                <div className="card roles-card">
                  <h3 className="section-title">Roles you can apply to now</h3>
                  <div className="roles-list">
                    {sortedRoles.map((r, i) => (
                      <div key={i} className="role-item">
                        <div className="role-header">
                          <span className="role-name">{r.role}</span>
                          <FitBar fit={r.fit} />
                        </div>
                        <p className="role-reason">{r.reason}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="insights-grid">
                <div className="card">
                  <h3 className="section-title insights-title strengths">Strengths</h3>
                  <ul className="insights-list">{result.topStrengths.map((s, i) => <li key={i}>{s}</li>)}</ul>
                </div>
                <div className="card">
                  <h3 className="section-title insights-title concerns">Concerns</h3>
                  <ul className="insights-list">{result.topConcerns.map((c, i) => <li key={i}>{c}</li>)}</ul>
                </div>
                <div className="card">
                  <h3 className="section-title insights-title changes">→ Key Changes</h3>
                  <ul className="insights-list">{result.keyChanges.map((k, i) => <li key={i}>{k}</li>)}</ul>
                </div>
              </div>

              {result.cvAdjustments.length > 0 && (
                <div className="card adjustments-card">
                  <h3 className="section-title">CV Adjustments</h3>
                  <div className="adjustments-list">
                    {result.cvAdjustments.map((adj, i) => (
                      <div key={i} className="adjustment-item">
                        <span className="adj-section">{adj.section}</span>
                        <span className="adj-action">{adj.action}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {sortedCourses.length > 0 && (
                <div className="card courses-card">
                  <h3 className="section-title">▣ Courses to close the gap</h3>
                  <div className="courses-list">
                    {sortedCourses.map((c, i) => (
                      <div key={i} className="course-item">
                        <div className="course-header">
                          <div className="course-meta">
                            <span className="course-skill">{c.skill}</span>
                            <span className="course-platform">{c.platform}</span>
                          </div>
                          <span className="course-priority" style={{ color: PRIORITY_COLOR[c.priority] }}>
                            {PRIORITY_LABEL[c.priority]}
                          </span>
                        </div>
                        <p className="course-name">{c.course}</p>
                        <p className="course-why">{c.why}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          <h2 className="section-title reactions-title">Hiring Manager Reactions</h2>
          <div className="reactions-grid">
            {streamedManagers.map(r => (
              <div key={r.index} className={`card reaction-card ${r.wouldAdvance ? 'advance' : 'pass'}`}>
                <div className="reaction-header">
                  <div>
                    <strong>{r.profile.name}</strong>
                    <p className="reaction-role">{r.profile.role}</p>
                  </div>
                  <span className={`decision-badge ${r.wouldAdvance ? 'yes' : 'no'}`}>
                    {r.wouldAdvance ? 'ADVANCE' : 'PASS'}
                  </span>
                </div>
                <p className="reaction-text">{r.reaction}</p>
                {r.positives.length > 0 && (
                  <div className="reaction-tags">
                    {r.positives.map((p, i) => <span key={i} className="badge positive-tag">{p}</span>)}
                  </div>
                )}
                {r.concerns.length > 0 && (
                  <div className="reaction-tags" style={{ marginTop: '0.4rem' }}>
                    {r.concerns.map((c, i) => <span key={i} className="badge concern-tag">{c}</span>)}
                  </div>
                )}
              </div>
            ))}
          </div>

          {result && (
            <>
              <div className="support-section">
                <div className="support-inner">
                  <div className="support-text">
                    <p className="support-title">Did this help your job search?</p>
                    <p className="support-sub">This tool is free and open source. Support keeps it running.</p>
                  </div>
                  <div className="support-actions">
                    <a href="https://github.com/GerardoLucero/cv-stress-test" target="_blank" rel="noopener noreferrer" className="btn btn-outline">
                      Star on GitHub
                    </a>
                    <a href="https://ko-fi.com/gerardolucero" target="_blank" rel="noopener noreferrer" className="btn btn-kofi">
                      Ko-fi
                    </a>
                    <a href="https://buymeacoffee.com/lucerorios0" target="_blank" rel="noopener noreferrer" className="btn btn-bmc">
                      Buy Me a Coffee
                    </a>
                  </div>
                </div>
              </div>

              <div className="footer-meta no-print">
                <span className="badge">{streamedManagers.length} managers · {totalTokens.toLocaleString()} tokens · {(durationMs / 1000).toFixed(1)}s</span>
              </div>
            </>
          )}
        </section>
      )}
    </>
  )}
    </main>
  )
}
