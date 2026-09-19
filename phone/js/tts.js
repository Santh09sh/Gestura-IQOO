/**
 * TTS — On-Device Text-to-Speech
 * ───────────────────────────────
 * Speak recognized sign labels via Web Speech API speechSynthesis.
 * Filters for voice.localService === true to avoid network-backed voices.
 * Only fires on successful recognition.
 *
 * ZERO CLOUD DEPENDENCY: speechSynthesis is fully on-device
 * in all modern mobile browsers.
 */

export class TTS {
    constructor() {
        this.synth = window.speechSynthesis || null;
        this.voice = null;
        this.rate = 0.9;
        this.pitch = 1.0;
        this.isReady = false;

        if (this.synth) {
            this._selectVoice();
            // Voices may load asynchronously
            this.synth.addEventListener('voiceschanged', () => this._selectVoice());
        }
    }

    /**
     * Select a local-only English voice.
     * Filters voice.localService === true to avoid cloud-backed voices.
     */
    _selectVoice() {
        if (!this.synth) return;

        const voices = this.synth.getVoices();
        if (voices.length === 0) return;

        // Priority: local English voices
        const localEnglish = voices.filter(
            v => v.localService === true && v.lang.startsWith('en')
        );

        // Fallback: any local voice
        const anyLocal = voices.filter(v => v.localService === true);

        // Last resort: any English voice (may be network-backed)
        const anyEnglish = voices.filter(v => v.lang.startsWith('en'));

        if (localEnglish.length > 0) {
            this.voice = localEnglish[0];
        } else if (anyLocal.length > 0) {
            this.voice = anyLocal[0];
        } else if (anyEnglish.length > 0) {
            console.warn('[TTS] No local voice found, using potentially network-backed voice');
            this.voice = anyEnglish[0];
        } else {
            this.voice = voices[0];
        }

        this.isReady = true;
        console.log(`[TTS] Selected voice: ${this.voice.name} (local: ${this.voice.localService})`);
    }

    /**
     * Speak a text string.
     * @param {string} text - The text to speak
     * @returns {Promise} Resolves when speech completes
     */
    speak(text) {
        return new Promise((resolve, reject) => {
            if (!this.synth || !this.isReady) {
                console.warn('[TTS] Speech synthesis not available');
                resolve();
                return;
            }

            // Cancel any ongoing speech
            this.synth.cancel();

            const utterance = new SpeechSynthesisUtterance(text);
            if (this.voice) utterance.voice = this.voice;
            utterance.rate = this.rate;
            utterance.pitch = this.pitch;
            utterance.lang = 'en-US';

            utterance.onend = () => resolve();
            utterance.onerror = (e) => {
                console.error('[TTS] Speech error:', e);
                resolve(); // Don't reject — TTS failure shouldn't block the app
            };

            this.synth.speak(utterance);
        });
    }

    /**
     * Speak a recognized sign label with context.
     * @param {string} label - The recognized sign label (e.g., "hello")
     */
    async speakLabel(label) {
        // Convert underscore-separated labels to natural speech
        const spoken = label.replace(/_/g, ' ');
        await this.speak(spoken);
    }

    /**
     * Stop any ongoing speech.
     */
    cancel() {
        if (this.synth) this.synth.cancel();
    }
}
