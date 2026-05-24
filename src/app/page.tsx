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
interface ApiResponse {
  result: AnalysisResult; reactions: ManagerReaction[]; totalTokens: number; durationMs: number
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
  const [data, setData] = useState<ApiResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [runCount, setRunCount] = useState(0)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setData(null)
    setError(null)
    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cv, jobDescription, n }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Unknown error')
      setData(json)
      setRunCount(c => c + 1)
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }

  const visible = data?.reactions.filter(r => !r.error && r.reaction) ?? []
  // Sorted copies — never mutate state arrays
  const sortedRoles = [...(data?.result.suggestedRoles ?? [])].sort((a, b) => b.fit - a.fit)
  const sortedCourses = [...(data?.result.courseRecommendations ?? [])].sort(
    (a, b) => (PRIORITY_ORDER[a.priority] ?? 1) - (PRIORITY_ORDER[b.priority] ?? 1)
  )

  return (
    <main>
      <section className="hero no-print">
        <div className="container">
          <div className="hero-tag">
            <span className="badge badge-accent">⬡ AI-Powered</span>
            <span className="badge">Groq · LLaMA 3</span>
          </div>
          <h1>CV <span className="gradient-text">Stress Test</span></h1>
          <p className="hero-sub">
            Simulate how <strong>N hiring managers</strong> react to your CV.
            Discover what roles fit you and exactly what to fix.
          </p>
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
            <div className="spinner" />
            <span>Simulating <strong>{n} industry-specific hiring managers</strong>… ~{n * 4}s</span>
          </div>
        </div>
      )}

      {error && (
        <div className="container no-print">
          <div className="card error-card">{error}</div>
        </div>
      )}

      {data && (
        <section key={runCount} className="container results" id="report">

          <div className="print-header">
            <h1>CV Stress Test — Report</h1>
            <p className="print-meta">Generated on {new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
          </div>

          <div className="report-actions no-print">
            <button className="btn btn-outline" onClick={() => window.print()}>⤓ Download PDF</button>
          </div>

          <div className="summary-grid">
            <div className="card advance-card">
              <div className="advance-rate">
                <span className="rate-number">{data.result.advanceRate}%</span>
                <span className="rate-label">would advance you</span>
              </div>
              <div className="rate-bar">
                <div className="rate-fill" style={{ width: `${data.result.advanceRate}%` }} />
              </div>
            </div>
            <div className="card verdict-card">
              <h3 className="section-title">Verdict</h3>
              <p className="verdict-text">{data.result.verdict}</p>
              <p className="one-liner">&ldquo;{data.result.oneLiner}&rdquo;</p>
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
              <ul className="insights-list">{data.result.topStrengths.map((s, i) => <li key={i}>{s}</li>)}</ul>
            </div>
            <div className="card">
              <h3 className="section-title insights-title concerns">✗ Concerns</h3>
              <ul className="insights-list">{data.result.topConcerns.map((c, i) => <li key={i}>{c}</li>)}</ul>
            </div>
            <div className="card">
              <h3 className="section-title insights-title changes">→ Key Changes</h3>
              <ul className="insights-list">{data.result.keyChanges.map((k, i) => <li key={i}>{k}</li>)}</ul>
            </div>
          </div>

          {data.result.cvAdjustments.length > 0 && (
            <div className="card adjustments-card">
              <h3 className="section-title">✎ CV Adjustments</h3>
              <div className="adjustments-list">
                {data.result.cvAdjustments.map((adj, i) => (
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

          <h2 className="section-title reactions-title">Hiring Manager Reactions</h2>
          <div className="reactions-grid">
            {visible.map(r => (
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

          <div className="footer-meta no-print">
            <span className="badge">{visible.length} managers · {data.totalTokens.toLocaleString()} tokens · {(data.durationMs / 1000).toFixed(1)}s</span>
            <span className="badge badge-accent">Powered by Groq + LLaMA 3</span>
          </div>
        </section>
      )}
    </main>
  )
}
