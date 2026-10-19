'use client'

import { useEffect, useRef, useState } from 'react'
import { InterviewSession, TurnEvaluation } from '@/sdk/types'
import { SpeechHelper } from '@/sdk/speech-helper'

interface LiveInterviewRoomProps {
  initialSession: InterviewSession
  initialToken: string
  /** Called after every answered turn so the parent keeps the latest state across tab switches. */
  onProgress: (session: InterviewSession, token: string) => void
  onFinish: (session: InterviewSession) => void
}

export function LiveInterviewRoom({ initialSession, initialToken, onProgress, onFinish }: LiveInterviewRoomProps) {
  const [session, setSession] = useState<InterviewSession>(initialSession)
  // Sealed server state: the server keeps no session, so it comes back with every call.
  const [token, setToken] = useState(initialToken)
  const [roomError, setRoomError] = useState<string | null>(null)
  const finalizingRef = useRef(false)
  const [interimText, setInterimText] = useState('')
  const [currentAnswer, setCurrentAnswer] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isFinalizing, setIsFinalizing] = useState(false)
  const [isListening, setIsListening] = useState(false)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [isCameraActive, setIsCameraActive] = useState(true)
  const [latencyWarning, setLatencyWarning] = useState<string | null>(null)
  const [mode, setMode] = useState<'voice' | 'chat'>('voice')
  const [lastTurnFeedback, setLastTurnFeedback] = useState<TurnEvaluation | null>(null)

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const speechHelperRef = useRef<SpeechHelper | null>(null)

  // Initialize camera and speech helper
  useEffect(() => {
    // 1. Initialize Speech Helper
    const speech = new SpeechHelper({
      lang: session.persona.voiceConfig?.lang ?? 'es-MX',
      onTranscript: (text, isFinal) => {
        if (isFinal) {
          setInterimText('')
          setCurrentAnswer((prev) => (prev ? `${prev} ${text.trim()}` : text.trim()))
        } else {
          setInterimText(text)
        }
      },
      onEnd: () => {
        setIsListening(false)
        setInterimText('')
      },
      onLatencyWarning: (ms) => {
        setLatencyWarning(`Escucha lenta detectada (${Math.round(ms / 1000)}s). Se recomienda cambiar a modo texto.`)
      },
      onError: (err) => {
        console.warn('Speech error:', err)
        setLatencyWarning('Micrófono o reconocimiento de voz con fallos. Puedes escribir en modo chat.')
      },
    })
    speechHelperRef.current = speech

    // Browsers without Web Speech (Firefox) fall back to text.
    if (!speech.isSupported()) setMode('chat')

    // 2. Read the pending question aloud
    if (session.currentQuestion) {
      speakQuestion(session.currentQuestion)
    }

    // 3. Initialize Camera
    let cancelled = false
    startCamera(() => cancelled)

    return () => {
      cancelled = true
      stopCamera()
      speechHelperRef.current?.stopSpeaking()
      speechHelperRef.current?.stopListening()
    }
  }, [])

  async function startCamera(isCancelled: () => boolean = () => false) {
    try {
      // Video only: speech recognition opens the microphone itself.
      const stream = await navigator.mediaDevices.getUserMedia({ video: true })
      // The room unmounted while the permission prompt was open: release the camera at once.
      if (isCancelled()) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }
      mediaStreamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
      }
      setIsCameraActive(true)
    } catch (e) {
      console.warn('Could not access webcam:', e)
      setIsCameraActive(false)
    }
  }

  function stopCamera() {
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop())
      mediaStreamRef.current = null
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
    setIsCameraActive(false)
  }

  function toggleCamera() {
    if (isCameraActive) {
      stopCamera()
    } else {
      startCamera()
    }
  }

  async function speakQuestion(text: string) {
    if (!speechHelperRef.current) return
    setIsSpeaking(true)
    await speechHelperRef.current.speak(text, session.persona.voiceConfig)
    setIsSpeaking(false)
  }

  function toggleListening() {
    if (!speechHelperRef.current) return
    if (isListening) {
      speechHelperRef.current.stopListening()
      setIsListening(false)
    } else {
      setLatencyWarning(null)
      speechHelperRef.current.startListening()
      setIsListening(true)
    }
  }

  async function handleSubmitAnswer() {
    if (!currentAnswer.trim() || isSubmitting) return

    if (isListening && speechHelperRef.current) {
      speechHelperRef.current.stopListening()
      setIsListening(false)
    }

    setIsSubmitting(true)
    setLatencyWarning(null)

    try {
      const res = await fetch('/api/interview/answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, answer: currentAnswer.trim() }),
      })

      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? 'Error al procesar la respuesta')

      setSession(data.session)
      setToken(data.token)
      setRoomError(null)
      onProgress(data.session, data.token)
      setLastTurnFeedback(data.turnEvaluation)
      setCurrentAnswer('')

      if (data.isFinished) {
        void handleFinalize(data.token)
      } else if (data.nextQuestion) {
        speakQuestion(data.nextQuestion)
      }
    } catch (err: any) {
      setRoomError(err.message)
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleFinalize(tokenToFinalize: string = token) {
    // The auto-finish after the last answer and the "Terminar" button can race.
    if (finalizingRef.current) return
    finalizingRef.current = true
    setIsFinalizing(true)
    try {
      const res = await fetch('/api/interview/finalize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: tokenToFinalize }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? 'Error al finalizar la sesión')

      setSession(data.session)
      setToken(data.token)
      onFinish(data.session)
    } catch (err: any) {
      finalizingRef.current = false
      setRoomError(`No se pudo generar el reporte final: ${err.message}`)
    } finally {
      setIsFinalizing(false)
    }
  }

  const currentTurnNumber = session.turns.length

  return (
    <div className="interview-room-container">
      {/* Top Bar Header */}
      <div className="room-header">
        <div className="room-persona-info">
          <span className="room-avatar">{session.persona.avatar}</span>
          <div>
            <h3 className="room-persona-name">{session.persona.name}</h3>
            <p className="room-persona-role">{session.persona.role}</p>
          </div>
          <span className={`status-indicator ${isSpeaking ? 'speaking' : isListening ? 'listening' : 'idle'}`}>
            {isSpeaking ? '🔊 Hablando...' : isListening ? '🎙️ Escuchándote...' : isSubmitting ? '🧠 Analizando...' : '🟢 Listo'}
          </span>
        </div>

        <div className="room-controls-right">
          <div className="mode-toggle">
            <button
              onClick={() => setMode('voice')}
              className={`mode-btn ${mode === 'voice' ? 'active' : ''}`}
            >
              🎙️ Videollamada
            </button>
            <button
              onClick={() => setMode('chat')}
              className={`mode-btn ${mode === 'chat' ? 'active' : ''}`}
            >
              💬 Chat Rápido
            </button>
          </div>

          <div className="round-progress">
            Pregunta {currentTurnNumber} de {session.totalQuestions}
          </div>

          <button
            onClick={() => handleFinalize()}
            disabled={isFinalizing || session.turns.length < 1}
            className="btn-finish-early"
            title="Concluir entrevista y calcular veredicto con las respuestas dadas hasta ahora"
          >
            {isFinalizing ? 'Concluyendo...' : 'Terminar Entrevista'}
          </button>
        </div>
      </div>

      {roomError && (
        <div className="latency-warning-banner" role="alert">
          <span>⚠️ {roomError}</span>
        </div>
      )}

      {/* Latency / Speed Fallback Banner */}
      {latencyWarning && (
        <div className="latency-warning-banner">
          <span>⚠️ {latencyWarning}</span>
          <button onClick={() => setMode('chat')} className="btn-switch-text">
            Cambiar a Solo Texto
          </button>
        </div>
      )}

      {/* Main Grid: Video / Cam on Left, Interview Console on Right */}
      <div className="room-grid">
        {/* Left Column: Video & Audio Telemetry */}
        <div className="video-col">
          <div className="webcam-box">
            {isCameraActive ? (
              <video ref={videoRef} autoPlay playsInline muted className="webcam-feed" />
            ) : (
              <div className="webcam-placeholder">
                <span className="placeholder-icon">📷</span>
                <p>Cámara apagada</p>
              </div>
            )}
            <div className="webcam-overlay">
              <span className="candidate-badge">Tú (Candidato)</span>
              <button onClick={toggleCamera} className="cam-toggle-btn">
                {isCameraActive ? 'Desactivar Cámara' : 'Activar Cámara'}
              </button>
            </div>
          </div>

          {/* Audio State / Microphone Visualizer */}
          <div className="audio-telemetry-box">
            <div className="mic-status-row">
              <div className="mic-indicator">
                <span className={`mic-dot ${isListening ? 'active' : ''}`} />
                <span>{isListening ? 'Micrófono activo (habla con naturalidad)' : 'Micrófono pausado'}</span>
              </div>
              <button
                onClick={toggleListening}
                className={`btn-mic-toggle ${isListening ? 'listening' : ''}`}
              >
                {isListening ? '⏹️ Detener Escucha' : '🎙️ Presiona para Hablar'}
              </button>
            </div>

            {/* Quick Live Coaching Pill */}
            {lastTurnFeedback && (
              <div className="live-coaching-box">
                <div className="coaching-header">
                  <strong>Evaluación Ronda Anterior: {lastTurnFeedback.score}/100</strong>
                </div>
                <p className="coaching-text">{lastTurnFeedback.quickFeedback}</p>
                <div className="star-mini-pills">
                  <span className={`star-pill ${lastTurnFeedback.starAssessment.situation}`}>
                    S: {lastTurnFeedback.starAssessment.situation}
                  </span>
                  <span className={`star-pill ${lastTurnFeedback.starAssessment.task}`}>
                    T: {lastTurnFeedback.starAssessment.task}
                  </span>
                  <span className={`star-pill ${lastTurnFeedback.starAssessment.action}`}>
                    A: {lastTurnFeedback.starAssessment.action}
                  </span>
                  <span className={`star-pill ${lastTurnFeedback.starAssessment.result}`}>
                    R: {lastTurnFeedback.starAssessment.result}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Question & Candidate Response Console */}
        <div className="console-col">
          {/* Question Card */}
          <div className="question-card">
            <div className="question-badge-row">
              <span className="q-badge">Pregunta {currentTurnNumber}</span>
              <button
                onClick={() => speakQuestion(session.currentQuestion)}
                disabled={isSpeaking}
                className="btn-replay-audio"
              >
                {isSpeaking ? '🔊 Hablando...' : '🔊 Repetir en Voz Alta'}
              </button>
            </div>
            <h2 className="current-question-text">{session.currentQuestion}</h2>
          </div>

          {/* Candidate Response Editor */}
          <div className="response-box">
            <label className="response-label" htmlFor="interview-answer">
              <span>{isListening ? '🎙️ Escuchando y transcribiendo...' : 'Tu respuesta:'}</span>
              <span className="char-count">{currentAnswer.length} caracteres</span>
            </label>
            <textarea
              id="interview-answer"
              value={currentAnswer}
              onChange={(e) => setCurrentAnswer(e.target.value)}
              placeholder="Habla por el micrófono o escribe detalladamente tu respuesta aquí. Procura incluir el contexto, qué acción específica tomaste tú y cuál fue el resultado numérico/técnico..."
              rows={mode === 'chat' ? 8 : 5}
              className="response-textarea"
              disabled={isSubmitting}
            />

            {interimText && (
              <p className="char-count" aria-live="polite">{interimText}</p>
            )}

            <div className="response-actions">
              <button
                onClick={() => setCurrentAnswer('')}
                disabled={!currentAnswer || isSubmitting}
                className="btn-clear"
              >
                Limpiar
              </button>
              <button
                onClick={handleSubmitAnswer}
                disabled={!currentAnswer.trim() || isSubmitting}
                className="btn-send-answer"
              >
                {isSubmitting ? '🧠 Evaluando respuesta...' : 'Enviar Respuesta y Continuar ➔'}
              </button>
            </div>
          </div>

          {/* Transcript History Accordion */}
          {session.turns.length > 1 && (
            <div className="turns-history">
              <h4 className="history-title">📜 Historial de Rondas Anteriores</h4>
              <div className="history-list">
                {session.turns.slice(0, -1).map((turn) => (
                  <div key={turn.turnNumber} className="history-item">
                    <div className="history-q">
                      <strong>R{turn.turnNumber}:</strong> {turn.question}
                    </div>
                    <div className="history-a">
                      <span>Tu respuesta:</span> {turn.candidateAnswer}
                    </div>
                    {turn.evaluation && (
                      <div className="history-score-chip">
                        Score: <strong>{turn.evaluation.score}/100</strong> · {turn.evaluation.quickFeedback}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
