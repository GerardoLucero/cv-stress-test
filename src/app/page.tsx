'use client'

import { useState } from 'react'

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
            <span className="badge badge-accent">⬡ AI-Powered</span>
            <span className="badge">Groq · LLaMA 3.3 70B</span>
            <span className="badge">Free & Open Source</span>
          </div>
          <h1>CV <span className="gradient-text">Stress Test</span></h1>
          <p className="hero-sub">
            <strong>N hiring managers</strong> read your CV. See what they think.
          </p>
          <p className="hero-sub2">Discover which roles fit you and exactly what to fix — before you send it.</p>
        </div>
      </section>

      <section className="form-section no-print">
        <div className="container">
          <form onSubmit={handleSubmit}>
            <div className="form-grid">
              <div className="field">
                <label>Your CV</label>
                <textarea value={cv} onChange={e => setCv(e.target.value)} placeholder="Paste your full CV here..." rows={14} required />
              </div>
              <div className="field">
                <label>Job Description</label>
                <textarea value={jobDescription} onChange={e => setJobDescription(e.target.value)} placeholder="Paste the job description here..." rows={14} required />
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
              ⚠️ {warning}
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
                  <h3 className="section-title">⬡ Roles you can apply to now</h3>
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
                  <h3 className="section-title insights-title strengths">✓ Strengths</h3>
                  <ul className="insights-list">{result.topStrengths.map((s, i) => <li key={i}>{s}</li>)}</ul>
                </div>
                <div className="card">
                  <h3 className="section-title insights-title concerns">✗ Concerns</h3>
                  <ul className="insights-list">{result.topConcerns.map((c, i) => <li key={i}>{c}</li>)}</ul>
                </div>
                <div className="card">
                  <h3 className="section-title insights-title changes">→ Key Changes</h3>
                  <ul className="insights-list">{result.keyChanges.map((k, i) => <li key={i}>{k}</li>)}</ul>
                </div>
              </div>

              {result.cvAdjustments.length > 0 && (
                <div className="card adjustments-card">
                  <h3 className="section-title">✎ CV Adjustments</h3>
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
                      ★ Star on GitHub
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
                <span className="badge badge-accent">Powered by Groq · LLaMA 3.3 70B</span>
              </div>
            </>
          )}
        </section>
      )}
    </main>
  )
}
