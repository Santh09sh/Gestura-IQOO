/**
 * ASR — On-Device Speech Recognition for Captions
 * ─────────────────────────────────────────────────
 * First attempt: SpeechRecognition with processLocally = true
 * (Chrome's on-device recognition API).
 *
 * Fallback: Stream audio to the server's /transcribe endpoint
 * (faster-whisper on the laptop).
 *
 * NEVER ships the default cloud-routing configuration.
 * If on-device recognition isn't available, we use the server fallback.
 */

export class ASR {
    constructor(network) {
        this.network = network;          // Network instance for /transcribe fallback
        this.recognition = null;
        this.isListening = false;
        this.mode = 'none';              // 'local', 'server', 'none'
        this.onResult = null;            // Callback: (text, isFinal) => {}
        this.onStatusChange = null;      // Callback: (status: string) => {}
        this.mediaRecorder = null;       // For server fallback
        this.audioChunks = [];
        this._stream = null;
    }

    /**
     * Initialize ASR. Tries on-device first, falls back to server.
     * @returns {string} Mode that was initialized: 'local', 'server', or 'none'
     */
    async init() {
        // Try on-device recognition first
        const localAvailable = await this._tryLocalInit();
        if (localAvailable) {
            this.mode = 'local';
            this._notifyStatus('On-device recognition ready');
            console.log('[ASR] Using on-device (processLocally) recognition');
            return 'local';
        }

        // Fall back to server-side transcription
        const serverAvailable = this.network && this.network.isConfigured;
        if (serverAvailable) {
            this.mode = 'server';
            this._notifyStatus('Using server for captions');
            console.log('[ASR] Falling back to server-side transcription (/transcribe)');
            return 'server';
        }

        this.mode = 'none';
        this._notifyStatus('Captions unavailable');
        console.warn('[ASR] No ASR method available');
        return 'none';
    }

    /**
     * Try to initialize the on-device SpeechRecognition with processLocally.
     * @returns {boolean} true if local recognition is available
     */
    async _tryLocalInit() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            console.log('[ASR] SpeechRecognition API not available');
            return false;
        }

        try {
            // Check if on-device recognition is available (newer Chrome API)
            if (typeof SpeechRecognition.available === 'function') {
                this._notifyStatus('Checking on-device recognition…');
                const availability = await SpeechRecognition.available({
                    langs: ['en-US'],
                    processLocally: true,
                });

                if (availability === 'not-available' || availability === 'no') {
                    console.log('[ASR] On-device recognition not available for en-US');

                    // Try to install the language pack
                    if (typeof SpeechRecognition.install === 'function') {
                        try {
                            this._notifyStatus('Downloading language pack…');
                            await SpeechRecognition.install({
                                langs: ['en-US'],
                                processLocally: true,
                            });
                            console.log('[ASR] Language pack installed');
                        } catch (installErr) {
                            console.warn('[ASR] Language pack install failed:', installErr);
                            return false;
                        }
                    } else {
                        return false;
                    }
                }
            }

            // Create recognition instance
            this.recognition = new SpeechRecognition();
            this.recognition.lang = 'en-US';
            this.recognition.continuous = true;
            this.recognition.interimResults = true;

            // Set processLocally if supported — CRITICAL: without this,
            // audio silently routes to Google's cloud servers
            if ('processLocally' in this.recognition) {
                this.recognition.processLocally = true;
                console.log('[ASR] processLocally = true set successfully');
            } else {
                // processLocally not supported — this browser WILL use cloud
                // Do NOT proceed with this path
                console.warn('[ASR] processLocally not supported — rejecting to avoid cloud routing');
                this.recognition = null;
                return false;
            }

            // Set up event handlers
            this.recognition.onresult = (event) => {
                let transcript = '';
                let isFinal = false;

                for (let i = event.resultIndex; i < event.results.length; i++) {
                    transcript += event.results[i][0].transcript;
                    if (event.results[i].isFinal) isFinal = true;
                }

                if (this.onResult) {
                    this.onResult(transcript.trim(), isFinal);
                }
            };

            this.recognition.onerror = (event) => {
                console.error('[ASR] Recognition error:', event.error);
                if (event.error === 'not-allowed') {
                    this._notifyStatus('Microphone access denied');
                } else if (event.error === 'language-not-supported') {
                    // Known issue — language pack may not actually work
                    console.warn('[ASR] Language not supported despite install attempt');
                    this._notifyStatus('Falling back to server…');
                    this._switchToServerFallback();
                }
            };

            this.recognition.onend = () => {
                // Auto-restart if we're supposed to be listening
                if (this.isListening && this.mode === 'local') {
                    try {
                        this.recognition.start();
                    } catch (e) {
                        // Ignore "already started" errors
                    }
                }
            };

            return true;

        } catch (err) {
            console.warn('[ASR] Local init failed:', err);
            return false;
        }
    }

    /**
     * Start listening for speech.
     */
    async startListening() {
        this.isListening = true;

        if (this.mode === 'local' && this.recognition) {
            try {
                this.recognition.start();
                this._notifyStatus('Listening (on-device)…');
            } catch (err) {
                console.error('[ASR] Failed to start recognition:', err);
            }
        } else if (this.mode === 'server') {
            await this._startServerRecording();
        }
    }

    /**
     * Stop listening.
     */
    stopListening() {
        this.isListening = false;

        if (this.mode === 'local' && this.recognition) {
            try {
                this.recognition.stop();
            } catch (e) {
                // Ignore
            }
        } else if (this.mode === 'server') {
            this._stopServerRecording();
        }

        this._notifyStatus('');
    }

    /**
     * Server fallback: record audio and send to /transcribe.
     */
    async _startServerRecording() {
        try {
            this._stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            this.mediaRecorder = new MediaRecorder(this._stream, {
                mimeType: 'audio/webm;codecs=opus',
            });
            this.audioChunks = [];

            this.mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    this.audioChunks.push(event.data);
                }
            };

            // Send audio chunks periodically
            this.mediaRecorder.onstop = async () => {
                if (this.audioChunks.length === 0) return;

                const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
                this.audioChunks = [];

                const result = await this.network.transcribe(audioBlob);
                if (result.text && this.onResult) {
                    this.onResult(result.text, true);
                }
            };

            // Record in 3-second chunks for near-realtime transcription
            this.mediaRecorder.start();
            this._notifyStatus('Listening (via server)…');

            this._chunkInterval = setInterval(() => {
                if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
                    this.mediaRecorder.stop();
                    this.mediaRecorder.start();
                }
            }, 3000);

        } catch (err) {
            console.error('[ASR] Server recording failed:', err);
            this._notifyStatus('Microphone access denied');
        }
    }

    _stopServerRecording() {
        if (this._chunkInterval) {
            clearInterval(this._chunkInterval);
            this._chunkInterval = null;
        }
        if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
            this.mediaRecorder.stop();
        }
        if (this._stream) {
            this._stream.getTracks().forEach(t => t.stop());
            this._stream = null;
        }
    }

    /**
     * Switch from failed local recognition to server fallback.
     */
    async _switchToServerFallback() {
        this.mode = 'server';
        if (this.recognition) {
            try { this.recognition.stop(); } catch (e) { /* ignore */ }
        }
        if (this.isListening) {
            await this._startServerRecording();
        }
    }

    _notifyStatus(status) {
        if (this.onStatusChange) this.onStatusChange(status);
    }

    /**
     * Clean up.
     */
    destroy() {
        this.stopListening();
        this.recognition = null;
    }
}
