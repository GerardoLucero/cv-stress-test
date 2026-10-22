'use client'

import { FinalScorecard, InterviewSession } from '@/sdk/types'

interface ScorecardViewProps {
  scorecard: FinalScorecard
  session: InterviewSession
  onRestart: () => void
}

export function ScorecardView({ scorecard, session, onRestart }: ScorecardViewProps) {
  const decisionLabels: Record<string, { label: string; color: string; bg: string }> = {
    STRONG_HIRE: { label: 'STRONG HIRE (Contratación Inmediata)', color: '#10b981', bg: 'rgba(16, 185, 129, 0.12)' },
    HIRE: { label: 'HIRE (Avanza a Oferta)', color: '#3b82f6', bg: 'rgba(59, 130, 246, 0.12)' },
    LEAN_NO: { label: 'LEAN NO (Dudas en Áreas Clave)', color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.12)' },
    NO_HIRE: { label: 'NO HIRE (No cumple barra del rol)', color: '#ef4444', bg: 'rgba(239, 68, 68, 0.12)' },
  }

  const decisionMeta = decisionLabels[scorecard.hiringDecision] ?? decisionLabels.LEAN_NO

  const dimensions = [
    { label: 'Rigor Técnico & Arquitectura', val: scorecard.radarScores.technicalAccuracy },
    { label: 'Metodología STAR (Estructura)', val: scorecard.radarScores.starMethodology },
    { label: 'Resolución de Problemas', val: scorecard.radarScores.problemSolving },
    { label: 'Claridad en Comunicación', val: scorecard.radarScores.communicationClarity },
    { label: 'Liderazgo & Ownership', val: scorecard.radarScores.leadershipOwnership },
  ]

  return (
    <div className="scorecard-container">
      {/* Header Veredicto */}
      <div className="scorecard-header-card" style={{ borderColor: decisionMeta.color }}>
        <div className="scorecard-badge-col">
          <div className="overall-score-circle" style={{ borderColor: decisionMeta.color }}>
            <span className="score-num">{scorecard.overallScore}</span>
            <span className="score-denom">/100</span>
          </div>
          <span
            className="decision-pill"
            style={{ color: decisionMeta.color, backgroundColor: decisionMeta.bg, borderColor: decisionMeta.color }}
          >
            {decisionMeta.label}
          </span>
        </div>

        <div className="scorecard-header-text">
          <h2 className="verdict-one-liner">&ldquo;{scorecard.verdictOneLiner}&rdquo;</h2>
          <p className="scorecard-summary">{scorecard.summary}</p>
          <div className="meta-tag-row">
            <span>Evaluado por: <strong>{session.persona.name} ({session.persona.role})</strong></span>
            <span>·</span>
            <span>Preguntas: <strong>{session.turns.length}</strong></span>
          </div>
        </div>
      </div>

      {/* Dimensiones / Radar Bars */}
      <div className="dimensions-card">
        <h3 className="section-title">Calificación por Competencias Clave</h3>
        <div className="dimensions-list">
          {dimensions.map((d) => (
            <div key={d.label} className="dimension-row">
              <div className="dimension-labels">
                <span>{d.label}</span>
                <strong>{d.val}%</strong>
              </div>
              <div className="dim-bar-track">
                <div
                  className="dim-bar-fill"
                  style={{
                    width: `${d.val}%`,
                    backgroundColor: d.val >= 75 ? '#10b981' : d.val >= 55 ? '#3b82f6' : '#f59e0b',
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Fortalezas y Brechas Críticas */}
      <div className="scorecard-insights-grid">
        <div className="insight-card strengths">
          <h4>Fortalezas Demostradas</h4>
          <ul>
            {scorecard.topStrengths.map((s, idx) => (
              <li key={idx}>{s}</li>
            ))}
          </ul>
        </div>

        <div className="insight-card gaps">
          <h4>Brechas Críticas Detectadas</h4>
          <ul>
            {scorecard.criticalGaps.map((g, idx) => (
              <li key={idx}>{g}</li>
            ))}
          </ul>
        </div>
      </div>

      {/* Ajustes al CV sugeridos */}
      {scorecard.cvAdjustments && scorecard.cvAdjustments.length > 0 && (
        <div className="cv-adjustments-card">
          <h3 className="section-title">Modificaciones Sugeridas a tu CV</h3>
          <p className="section-sub">
            Ajusta estas secciones para que tu CV refleje mejor tu capacidad y no active banderas rojas en entrevistas:
          </p>
          <div className="cv-adjustments-list">
            {scorecard.cvAdjustments.map((adj, idx) => (
              <div key={idx} className="cv-adj-item">
                <span className="cv-adj-section">{adj.section}</span>
                <p className="cv-adj-text">{adj.suggestedFix}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Acciones Recomendadas */}
      {scorecard.recommendedActions && scorecard.recommendedActions.length > 0 && (
        <div className="actions-card">
          <h3 className="section-title">Plan de Acción de Práctica</h3>
          <ul className="actions-list">
            {scorecard.recommendedActions.map((action, idx) => (
              <li key={idx}>{action}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Botones de acción */}
      <div className="scorecard-actions">
        <button onClick={onRestart} className="btn-primary-action">
          Realizar Nueva Entrevista
        </button>
      </div>
    </div>
  )
}
