'use client'

import { PRESET_PERSONAS } from '@/sdk/personas'
import { InterviewerPersona } from '@/sdk/types'

interface PersonaSelectorProps {
  selectedId: string
  onSelect: (persona: InterviewerPersona) => void
}

export function PersonaSelector({ selectedId, onSelect }: PersonaSelectorProps) {
  const personas = Object.values(PRESET_PERSONAS)

  return (
    <div className="persona-grid">
      {personas.map((p) => {
        const isSelected = p.id === selectedId
        return (
          <button
            type="button"
            key={p.id}
            onClick={() => onSelect(p)}
            aria-pressed={isSelected}
            className={`persona-card ${isSelected ? 'selected' : ''}`}
          >
            <div className="persona-header">
              <span className="persona-avatar">{p.avatar}</span>
              <div>
                <h4 className="persona-name">{p.name}</h4>
                <p className="persona-role">{p.role}</p>
              </div>
              <span className={`difficulty-badge ${p.difficulty}`}>{p.difficulty}</span>
            </div>
            <p className="persona-bias">{p.bias}</p>
            <div className="persona-tags">
              {p.focusAreas.slice(0, 3).map((area) => (
                <span key={area} className="persona-tag">
                  {area}
                </span>
              ))}
            </div>
          </button>
        )
      })}
    </div>
  )
}
