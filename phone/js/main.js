/**
 * Main — App Controller
 * ─────────────────────
 * Wires all modules together. Manages app state.
 *
 * RECOGNIZE MODE: Continuous recognition.
 *   Tap Start → auto-captures segments → sends each for recognition →
 *   displays word in caption → loops. Tap Stop to end.
 *
 * RECORD MODE: Manual start/stop per template.
 */

import { HandTracker } from './hand_tracker.js';
import { Capture } from './capture.js';
import { Network } from './network.js';
import { TTS } from './tts.js';
import { ASR } from './asr.js';

// ══════════════════════════════════════════════
// App State Machine
// ══════════════════════════════════════════════

const State = {
    IDLE: 'idle',
    CONTINUOUS: 'continuous',       // Continuously capturing & recognizing
    PROCESSING: 'processing',       // Sending a segment for recognition
    RESULT: 'result',
    RECORDING_REF: 'recording_ref', // Recording a DTW reference template
};

// How many frames to capture per recognition segment
const SEGMENT_FRAMES = 45;

// Minimum frames with a hand detected to consider a valid segment
const MIN_HAND_FRAMES = 15;

class GesturaApp {
    constructor() {
        this.state = State.IDLE;
        this.mode = 'recognize';     // 'recognize' or 'record'
        this.handTracker = new HandTracker();
        this.capture = new Capture();
        this.network = new Network();
        this.tts = new TTS();
        this.asr = null;
        this.captionHistory = [];

        // Continuous mode tracking
        this._continuousFrameCount = 0;
        this._handFrameCount = 0;
        this._wantContinuous = false;  // true while user wants continuous mode running

        // DOM refs — recognize mode
        this.btnCapture = document.getElementById('btn-capture');
        this.resultLabel = document.getElementById('result-label');
        this.confidenceContainer = document.getElementById('confidence-container');
        this.confidenceFill = document.getElementById('confidence-fill');
        this.confidenceText = document.getElementById('confidence-text');
        this.altSuggestion = document.getElementById('alt-suggestion');
        this.altLabel = document.getElementById('alt-label');
        this.processingIndicator = document.getElementById('processing-indicator');
        this.captionText = document.getElementById('caption-text');
        this.captionPlaceholder = document.getElementById('caption-placeholder');
        this.captionArea = document.getElementById('caption-area');

        // DOM refs — mode toggle
        this.modeRecognize = document.getElementById('mode-recognize');
        this.modeRecord = document.getElementById('mode-record');
        this.recognizeContent = document.getElementById('recognize-content');
        this.recordContent = document.getElementById('record-content');

        // DOM refs — live status panel (wider screens)
        this.statusCamera = document.getElementById('status-camera');
        this.iconCamera = document.getElementById('icon-camera');
        this.statusAi = document.getElementById('status-ai');
        this.iconAi = document.getElementById('icon-ai');
        this.statusConn = document.getElementById('status-conn');
        this.iconConn = document.getElementById('icon-conn');
        this.statusAudio = document.getElementById('status-audio');
        this.iconAudio = document.getElementById('icon-audio');
        this.statusLandmarks = document.getElementById('status-landmarks');
        this.statusConfidence = document.getElementById('status-confidence');

        // DOM refs — record mode
        this.signSelect = document.getElementById('sign-select');
        this.recordFeedbackText = document.getElementById('record-feedback-text');
        this.templateCountContainer = document.getElementById('template-count');
    }

    async init() {
        console.log('[Gestura] Initializing app…');

        // ── Initialize hand tracker ──
        try {
            const video = document.getElementById('camera-feed');
            const canvas = document.getElementById('landmark-canvas');

            await this.handTracker.init(video, canvas, (hands) => {
                this._onHandFrame(hands);
            });

            this.handTracker.start();
            this.btnCapture.disabled = false;
            if (this.statusCamera) {
                this.statusCamera.textContent = 'Active (waiting)';
                this.iconCamera.classList.add('active');
            }
            console.log('[Gestura] Hand tracker ready');
        } catch (err) {
            console.error('[Gestura] Hand tracker init failed:', err);
            this._showError('Camera access failed. Grant permission and reload.');
            if (this.statusCamera) {
                this.statusCamera.textContent = 'Error';
                this.iconCamera.classList.add('error');
            }
            return;
        }

        // ── Initialize ASR ──
        this.asr = new ASR(this.network);
        this.asr.onResult = (text, isFinal) => {
            this._updateCaption(text);
        };
        this.asr.onStatusChange = (status) => {
            console.log('[ASR Status]', status);
            if (this.statusAudio) {
                this.statusAudio.textContent = status === 'listening' ? 'Listening...' : 'TTS Ready';
                this.iconAudio.classList.toggle('active', status === 'listening');
            }
        };

        const asrMode = await this.asr.init();
        console.log(`[Gestura] ASR mode: ${asrMode}`);

        if (asrMode !== 'none') {
            await this.asr.startListening();
            if (this.statusAudio) {
                this.statusAudio.textContent = 'TTS Ready (ASR active)';
                this.iconAudio.classList.add('active');
            }
        } else if (this.statusAudio) {
            this.statusAudio.textContent = 'TTS Ready';
            this.iconAudio.classList.add('active');
        }

        // ── Set up capture state callback ──
        this.capture.onStateChange = (isCapturing, frameCount) => {
            this._updateCaptureUI(isCapturing, frameCount);
        };

        // ── Bind button events ──
        this.btnCapture.addEventListener('click', () => this._handleCaptureToggle());

        // ── Switch camera ──
        document.getElementById('btn-switch-camera').addEventListener('click', async () => {
            if (this.state === State.CONTINUOUS || this.state === State.RECORDING_REF) return;
            try {
                await this.handTracker.switchCamera();
            } catch (err) {
                console.error('[Gestura] Camera switch failed:', err);
            }
        });

        // ── Alt suggestion click → accept alternate label ──
        this.altLabel.addEventListener('click', () => {
            const altText = this.altLabel.textContent;
            if (altText) {
                this._displayResult(altText, 1.0);
                this.tts.speakLabel(altText);
            }
        });

        // ── Mode toggle ──
        this.modeRecognize.addEventListener('click', () => this._switchMode('recognize'));
        this.modeRecord.addEventListener('click', () => this._switchMode('record'));

        // ── Load initial template counts ──
        await this._refreshTemplateCounts();

        console.log('[Gestura] App ready');
    }

    // ──────────────────────────────────────────
    // Hand Frame Callback (called every frame)
    // ──────────────────────────────────────────

    _onHandFrame(hands) {
        const hasHands = hands && hands.length > 0;
        
        // Update live status panel
        if (this.statusLandmarks) {
            const numLandmarks = hasHands ? hands.reduce((sum, h) => sum + h.points.length, 0) : 0;
            this.statusLandmarks.textContent = numLandmarks;
            
            if (hasHands && this.statusCamera.textContent !== 'Tracking hand...') {
                this.statusCamera.textContent = 'Tracking hand...';
                this.iconCamera.classList.add('active');
            } else if (!hasHands && this.statusCamera.textContent !== 'Active (waiting)') {
                this.statusCamera.textContent = 'Active (waiting)';
            }
        }

        if (this.state === State.RECORDING_REF) {
            // Record mode: just buffer frames normally
            this.capture.addFrame(hands);
            return;
        }

        if (this.state === State.CONTINUOUS) {
            // Continuous recognize mode: auto-segment
            if (hasHands) {
                // Start capturing if not already
                if (!this.capture.isCapturing) {
                    this.capture.startCapture();
                    this._continuousFrameCount = 0;
                    this._handFrameCount = 0;
                }
                this.capture.addFrame(hands);
                this._continuousFrameCount++;
                this._handFrameCount++;

                // Once we have enough frames, auto-send for recognition
                if (this._continuousFrameCount >= SEGMENT_FRAMES) {
                    this._autoRecognize();
                }
            } else if (this.capture.isCapturing) {
                // No hand detected — add empty frame to count
                this._continuousFrameCount++;

                // If we have some hand frames and then lost the hand, send what we have
                if (this._handFrameCount >= MIN_HAND_FRAMES) {
                    this._autoRecognize();
                } else if (this._continuousFrameCount >= SEGMENT_FRAMES) {
                    // Too many empty frames, reset
                    this.capture.reset();
                    this._continuousFrameCount = 0;
                    this._handFrameCount = 0;
                }
            }
        }
    }

    // ──────────────────────────────────────────
    // Mode Switching
    // ──────────────────────────────────────────

    _switchMode(mode) {
        if (this.mode === mode) return;

        // Don't switch during active capture
        if (this.state === State.CONTINUOUS || this.state === State.RECORDING_REF) {
            return;
        }

        this.mode = mode;
        this.state = State.IDLE;

        // Toggle button active states
        this.modeRecognize.classList.toggle('active', mode === 'recognize');
        this.modeRecord.classList.toggle('active', mode === 'record');

        // Toggle content visibility
        this.recognizeContent.classList.toggle('hidden', mode !== 'recognize');
        this.recordContent.classList.toggle('hidden', mode !== 'record');

        // Reset UI
        this._clearResult();
        this.btnCapture.classList.remove('capturing');
        this.btnCapture.innerHTML = '●';

        if (mode === 'record') {
            this._refreshTemplateCounts();
        }
    }

    // ──────────────────────────────────────────
    // State Transitions
    // ──────────────────────────────────────────

    _handleCaptureToggle() {
        if (this.mode === 'record') {
            this._handleRecordToggle();
        } else {
            this._handleRecognizeToggle();
        }
    }

    _handleRecognizeToggle() {
        if (this.state === State.IDLE || this.state === State.RESULT) {
            // Start continuous recognition
            this._startContinuous();
        } else if (this.state === State.CONTINUOUS || this.state === State.PROCESSING) {
            // Stop continuous recognition
            this._stopContinuous();
        }
    }

    _startContinuous() {
        this.state = State.CONTINUOUS;
        this._wantContinuous = true;
        this._continuousFrameCount = 0;
        this._handFrameCount = 0;
        this._clearResult();

        this.btnCapture.classList.add('capturing');
        this.btnCapture.innerHTML = '■';  // Stop icon

        // Show a hint
        this.resultLabel.textContent = 'Show a sign…';
        this.resultLabel.classList.add('visible');
        this.resultLabel.classList.remove('low-confidence');
    }

    _stopContinuous() {
        this._wantContinuous = false;
        this.state = State.IDLE;
        this.capture.reset();

        this.btnCapture.classList.remove('capturing');
        this.btnCapture.innerHTML = '●';
        this.btnCapture.disabled = false;

        this.processingIndicator.classList.remove('visible');
        this.resultLabel.textContent = '';
        this.resultLabel.classList.remove('visible');
    }

    /**
     * Auto-recognize: take the current captured segment, send it,
     * display the result, and prepare for the next segment.
     */
    async _autoRecognize() {
        const request = this.capture.stopCapture();
        this._continuousFrameCount = 0;
        this._handFrameCount = 0;

        if (!request || request.landmarks.length === 0) {
            // No data — restart capture if still in continuous mode
            if (this._wantContinuous) {
                this.state = State.CONTINUOUS;
            }
            return;
        }

        // Show processing indicator briefly
        this.state = State.PROCESSING;
        this.processingIndicator.classList.add('visible');
        if (this.statusAi) {
            this.statusAi.textContent = 'Processing segment...';
            this.iconAi.classList.add('active');
        }

        try {
            const response = await this.network.recognize(request);

            this.processingIndicator.classList.remove('visible');
            if (this.statusAi) {
                this.statusAi.textContent = 'DTW Recognition';
                this.iconAi.classList.remove('active');
            }

            if (response.error) {
                console.warn('[Gestura] Recognition error:', response.error);
            } else {
                this._displayResult(response.label, response.confidence);

                // Append to caption transcript
                if (response.label && response.label !== 'unknown') {
                    this._appendSignCaption(response.label, response.confidence);
                }

                // Show "Did you mean?" for low confidence
                if (response.confidence < 0.5 && response.alternate_label) {
                    this._showAltSuggestion(response.alternate_label, response.alternate_confidence);
                } else {
                    this.altSuggestion.classList.remove('visible');
                }

                // Speak the result
                if (response.label && response.label !== 'unknown' && response.confidence >= 0.4) {
                    this.tts.speakLabel(response.label);
                }
            }
        } catch (err) {
            this.processingIndicator.classList.remove('visible');
            console.warn('[Gestura] Recognition request failed:', err.message);
        }

        // Continue capturing if user hasn't stopped
        if (this._wantContinuous) {
            this.state = State.CONTINUOUS;
            // Capture will restart on next hand frame via _onHandFrame
        } else {
            this.state = State.IDLE;
        }
    }

    _handleRecordToggle() {
        if (this.state === State.IDLE || this.state === State.RESULT) {
            this._startRecording();
        } else if (this.state === State.RECORDING_REF) {
            this._stopRecordingAndSave();
        }
    }

    // ──────────────────────────────────────────
    // Record Reference Mode
    // ──────────────────────────────────────────

    _startRecording() {
        this.state = State.RECORDING_REF;
        this.capture.startCapture();

        const signName = this.signSelect.value;
        this._setRecordFeedback(`Recording "${signName.replace(/_/g, ' ')}"… tap to stop`, '');

        this.btnCapture.classList.add('capturing');
        this.btnCapture.innerHTML = '■';
    }

    async _stopRecordingAndSave() {
        const request = this.capture.stopCapture();
        this.btnCapture.classList.remove('capturing');
        this.btnCapture.innerHTML = '●';

        const signName = this.signSelect.value;

        if (!request || request.landmarks.length === 0) {
            this.state = State.IDLE;
            this._setRecordFeedback('No landmarks captured. Show your hand and try again.', 'error');
            return;
        }

        // Show saving state
        this._setRecordFeedback('Saving template…', '');
        this.btnCapture.disabled = true;

        try {
            const response = await this.network.saveTemplate(signName, request.landmarks);

            this.state = State.IDLE;
            this.btnCapture.disabled = false;

            if (response.error) {
                this._setRecordFeedback(`Error: ${response.error}`, 'error');
                return;
            }

            this._setRecordFeedback(
                `Saved "${signName.replace(/_/g, ' ')}" (${response.total_for_sign} template${response.total_for_sign > 1 ? 's' : ''})`,
                'success'
            );

            // Refresh the template counts
            await this._refreshTemplateCounts();

        } catch (err) {
            this.state = State.IDLE;
            this.btnCapture.disabled = false;
            this._setRecordFeedback(`Failed: ${err.message}`, 'error');
        }
    }

    _setRecordFeedback(text, type) {
        this.recordFeedbackText.textContent = text;
        this.recordFeedbackText.className = 'record-feedback-text' + (type ? ` ${type}` : '');
    }

    async _refreshTemplateCounts() {
        try {
            const response = await this.network.ping();
            
            if (this.statusConn) {
                this.statusConn.textContent = 'Online';
                this.iconConn.classList.add('active');
                this.iconConn.classList.remove('error');
            }

            const reloadResponse = await this.network.reloadTemplates();

            if (reloadResponse && reloadResponse.signs) {
                this._renderTemplateCounts(reloadResponse.signs, reloadResponse.total_templates);
            }
        } catch (err) {
            console.warn('[Gestura] Could not load template counts:', err);
            if (this.statusConn) {
                this.statusConn.textContent = 'Offline';
                this.iconConn.classList.remove('active');
                this.iconConn.classList.add('error');
            }
        }
    }

    _renderTemplateCounts(signs, total) {
        const vocab = [
            'help', 'food', 'sorry', 'please', 'good', 'no', 'yes'
        ];

        const signSet = new Set(signs);

        let html = '';
        for (const sign of vocab) {
            const has = signSet.has(sign);
            const display = sign.replace(/_/g, ' ');
            html += `<span class="template-chip${has ? ' has-templates' : ''}">${display}${has ? ' ✓' : ''}</span>`;
        }

        this.templateCountContainer.innerHTML = html;
    }

    // ──────────────────────────────────────────
    // UI Updates
    // ──────────────────────────────────────────

    _displayResult(label, confidence) {
        // Label
        const displayLabel = label.replace(/_/g, ' ');
        this.resultLabel.textContent = displayLabel;
        this.resultLabel.classList.add('visible');

        if (confidence < 0.5) {
            this.resultLabel.classList.add('low-confidence');
        } else {
            this.resultLabel.classList.remove('low-confidence');
        }

        // Confidence bar
        this.confidenceContainer.classList.add('visible');
        const pct = Math.round(confidence * 100);
        this.confidenceFill.style.width = `${pct}%`;
        this.confidenceText.textContent = `${pct}% confidence`;
        
        if (this.statusConfidence) {
            this.statusConfidence.textContent = `${pct}%`;
        }

        // Color the bar based on confidence level
        this.confidenceFill.classList.remove('mid', 'low');
        if (confidence < 0.3) {
            this.confidenceFill.classList.add('low');
        } else if (confidence < 0.6) {
            this.confidenceFill.classList.add('mid');
        }
    }

    _showAltSuggestion(label, confidence) {
        const displayLabel = label.replace(/_/g, ' ');
        this.altLabel.textContent = displayLabel;
        this.altSuggestion.classList.add('visible');
    }

    _clearResult() {
        this.resultLabel.classList.remove('visible', 'low-confidence');
        this.resultLabel.textContent = '';
        this.confidenceContainer.classList.remove('visible');
        this.confidenceFill.style.width = '0%';
        this.altSuggestion.classList.remove('visible');
    }

    _updateCaptureUI(isCapturing, frameCount) {
        if (isCapturing) {
            this.btnCapture.title = `Capturing… (${frameCount} frames)`;
        } else {
            this.btnCapture.title = 'Tap to start capture';
        }
    }

    /**
     * Update caption from ASR (speech-to-text) results.
     */
    _updateCaption(text) {
        if (text) {
            this.captionText.textContent = text;
            this.captionText.classList.remove('hidden');
            this.captionPlaceholder.classList.add('hidden');
        }
    }

    /**
     * Append a recognized sign label to the caption transcript.
     */
    _appendSignCaption(label, confidence) {
        const displayLabel = label.replace(/_/g, ' ');

        // Add to history
        this.captionHistory.push(displayLabel);

        // Keep last 20 signs to avoid overflow
        if (this.captionHistory.length > 20) {
            this.captionHistory.shift();
        }

        // Build the transcript string
        const transcript = this.captionHistory.join(' · ');

        // Update the caption area
        this.captionText.textContent = transcript;
        this.captionText.classList.remove('hidden');
        this.captionPlaceholder.classList.add('hidden');

        // Add a brief highlight animation
        this.captionArea.classList.add('caption-updated');
        setTimeout(() => {
            this.captionArea.classList.remove('caption-updated');
        }, 600);
    }

    _showError(message) {
        this.resultLabel.textContent = message;
        this.resultLabel.classList.add('visible', 'low-confidence');
        this.confidenceContainer.classList.remove('visible');
    }
}

// ══════════════════════════════════════════════
// Bootstrap
// ══════════════════════════════════════════════

const app = new GesturaApp();
app.init().catch(err => {
    console.error('[Gestura] Fatal init error:', err);
});

