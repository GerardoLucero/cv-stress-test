/**
 * Speech Helper (Browser STT + TTS)
 * Zero-cost, runs entirely on the client.
 * Includes latency watchdog that recommends or auto-switches to text mode if speech is slow.
 */

export interface SpeechHelperOptions {
  onTranscript?: (text: string, isFinal: boolean) => void
  onError?: (error: string) => void
  onLatencyWarning?: (latencyMs: number) => void
  /** Fires when recognition stops on its own (Chrome ends it after silence). */
  onEnd?: () => void
  lang?: string
}

export class SpeechHelper {
  private recognition: any = null
  private isListening: boolean = false
  private speechStartTime: number = 0
  private maxAcceptableLatencyMs: number = 4000
  private options: SpeechHelperOptions

  constructor(options?: SpeechHelperOptions) {
    this.options = options ?? {}
    if (typeof window !== 'undefined') {
      const SpeechRecognition =
        (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
      if (SpeechRecognition) {
        this.recognition = new SpeechRecognition()
        this.recognition.continuous = true
        this.recognition.interimResults = true
        this.recognition.lang = this.options.lang ?? 'es-MX'

        this.recognition.onstart = () => {
          this.isListening = true
          this.speechStartTime = Date.now()
        }

        this.recognition.onresult = (event: any) => {
          let interimTranscript = ''
          let finalTranscript = ''

          for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
              finalTranscript += event.results[i][0].transcript
            } else {
              interimTranscript += event.results[i][0].transcript
            }
          }

          // Final and interim text are reported separately; mixing them duplicates words.
          if (finalTranscript) this.options.onTranscript?.(finalTranscript, true)
          if (interimTranscript) this.options.onTranscript?.(interimTranscript, false)

          // Watchdog: Check latency
          const elapsed = Date.now() - this.speechStartTime
          if (elapsed > this.maxAcceptableLatencyMs && this.options.onLatencyWarning) {
            this.options.onLatencyWarning(elapsed)
          }
        }

        this.recognition.onerror = (event: any) => {
          console.warn('[SpeechHelper] Recognition error:', event.error)
          if (this.options.onError) {
            this.options.onError(event.error)
          }
        }

        this.recognition.onend = () => {
          this.isListening = false
          this.options.onEnd?.()
        }
      }
    }
  }

  isSupported(): boolean {
    return Boolean(this.recognition)
  }

  startListening(): void {
    if (!this.recognition) {
      this.options.onError?.('Web Speech API is not supported in this browser.')
      return
    }
    try {
      this.speechStartTime = Date.now()
      this.recognition.start()
    } catch {
      // Already started
    }
  }

  stopListening(): void {
    if (this.recognition && this.isListening) {
      try {
        this.recognition.stop()
      } catch {
        // Ignored
      }
    }
  }

  speak(text: string, voiceConfig?: { pitch?: number; rate?: number; lang?: string }): Promise<void> {
    return new Promise((resolve) => {
      if (typeof window === 'undefined' || !window.speechSynthesis) {
        resolve()
        return
      }

      window.speechSynthesis.cancel() // Stop any ongoing speech

      const utterance = new SpeechSynthesisUtterance(text)
      utterance.pitch = voiceConfig?.pitch ?? 1.0
      utterance.rate = voiceConfig?.rate ?? 1.05
      utterance.lang = voiceConfig?.lang ?? 'es-MX'

      utterance.onend = () => resolve()
      utterance.onerror = () => resolve()

      const pickVoiceAndSpeak = () => {
        const match = window.speechSynthesis
          .getVoices()
          .find((v) => v.lang.startsWith(utterance.lang.slice(0, 2)))
        if (match) utterance.voice = match
        window.speechSynthesis.speak(utterance)
      }

      // Chrome and Safari return no voices until `voiceschanged` fires.
      if (window.speechSynthesis.getVoices().length > 0) {
        pickVoiceAndSpeak()
      } else {
        let spoken = false
        const once = () => {
          if (spoken) return
          spoken = true
          window.speechSynthesis.removeEventListener('voiceschanged', once)
          pickVoiceAndSpeak()
        }
        window.speechSynthesis.addEventListener('voiceschanged', once)
        setTimeout(once, 500)
      }
    })
  }

  stopSpeaking(): void {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel()
    }
  }
}
