import SpeakTTSModule from 'speak-tts';

const MAX_SPOKEN_TEXT_LENGTH = 260;

function resolveSpeakConstructor(mod) {
  let candidate = mod;

  // Unwrap nested CommonJS interop shapes such as default.default.
  for (let depth = 0; depth < 4; depth += 1) {
    if (typeof candidate === 'function') {
      return candidate;
    }

    if (!candidate || typeof candidate !== 'object' || !('default' in candidate)) {
      return null;
    }

    candidate = candidate.default;
  }

  return null;
}

const SpeakTTS = resolveSpeakConstructor(SpeakTTSModule);

class ChatVoiceover {
  constructor() {
    this._speech = SpeakTTS ? new SpeakTTS() : null;
    this._hasNativeSpeech = typeof window !== 'undefined'
      && 'speechSynthesis' in window
      && typeof SpeechSynthesisUtterance !== 'undefined';
    this._isSupported = this._hasNativeSpeech;
    this._enabled = true;
    this._ready = false;
    this._initPromise = null;
    this._useNativeFallback = false;
  }

  get isSupported() {
    return this._isSupported;
  }

  setEnabled(nextValue) {
    this._enabled = Boolean(nextValue);
    if (!this._enabled) {
      this.stop();
    }
  }

  async prime() {
    if (!this._enabled || !this._isSupported) return false;
    if (!this._speech) return true;

    try {
      await this._ensureReady();
      this._useNativeFallback = false;
      return true;
    } catch {
      this._useNativeFallback = true;
      return this._hasNativeSpeech;
    }
  }

  stop() {
    if (!this._isSupported) return;
    window.speechSynthesis.cancel();
  }

  async speakChatLine({ sender = '', message = '' }) {
    if (!this._enabled || !this._isSupported) return false;

    const normalizedMessage = String(message || '').trim();
    if (!normalizedMessage) return false;

    const normalizedSender = String(sender || '').trim();
    const line = normalizedSender
      ? `${normalizedSender} says ${normalizedMessage}`
      : normalizedMessage;
    const text = line.slice(0, MAX_SPOKEN_TEXT_LENGTH);

    if (!this._enabled) return false;

    if (this._speech && !this._useNativeFallback) {
      try {
        const ready = await this._ensureReady();
        if (ready && this._enabled) {
          const speakTtsOk = this._speakWithSpeakTts(text);
          if (speakTtsOk) return true;
          this._useNativeFallback = true;
        }
      } catch {
        this._useNativeFallback = true;
      }
    }

    return this._speakWithNativeApi(text);
  }

  async _ensureReady() {
    if (!this._isSupported) return false;
    if (!this._speech) return this._hasNativeSpeech;
    if (this._ready) return true;

    if (!this._initPromise) {
      const fallbackLang = typeof navigator !== 'undefined' ? navigator.language || 'en-US' : 'en-US';
      this._initPromise = this._speech
        .init({
          volume: 1,
          rate: 1,
          pitch: 1,
          splitSentences: true,
          lang: fallbackLang,
        })
        .then(() => {
          this._ready = true;
          return true;
        })
        .catch((error) => {
          this._initPromise = null;
          throw error;
        });
    }

    return this._initPromise;
  }

  _speakWithNativeApi(text) {
    if (!this._hasNativeSpeech || !this._enabled) return false;

    try {
      const synth = window.speechSynthesis;
      const utterance = new SpeechSynthesisUtterance(text);
      const fallbackLang = typeof navigator !== 'undefined' ? navigator.language || 'en-US' : 'en-US';
      const normalizedLang = String(fallbackLang).toLowerCase();
      const langPrefix = normalizedLang.split('-')[0];

      utterance.lang = fallbackLang;
      utterance.volume = 1;
      utterance.rate = 1;
      utterance.pitch = 1;

      const voices = synth.getVoices();
      const preferredVoice = voices.find((voice) => {
        const voiceLang = String(voice?.lang || '').toLowerCase();
        return voiceLang === normalizedLang || voiceLang.startsWith(`${langPrefix}-`);
      });

      if (preferredVoice) {
        utterance.voice = preferredVoice;
      }

      // Cancel current utterance so the newest chat line always plays.
      synth.cancel();
      synth.speak(utterance);
      return true;
    } catch {
      return false;
    }
  }

  _speakWithSpeakTts(text) {
    if (!this._speech || !this._enabled) return false;

    try {
      const maybePromise = this._speech.speak({
        text,
        queue: false,
      });

      // Some runtimes reject asynchronously after speak() returns.
      Promise.resolve(maybePromise).catch(() => {
        this._useNativeFallback = true;
        this._speakWithNativeApi(text);
      });

      return true;
    } catch {
      return false;
    }
  }
}

export function createChatVoiceover() {
  return new ChatVoiceover();
}
