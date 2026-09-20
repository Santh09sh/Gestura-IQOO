/**
 * Main — App Controller
 * ─────────────────────
 * Wires all modules together. Manages app state:
 *   idle → capturing → processing → result → idle
 *
 * Also handles the "Record Reference" mode for capturing
 * DTW reference templates.
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
    CAPTURING: 'capturing',
    PROCESSING: 'processing',
    RESULT: 'result',
    RECORDING_REF: 'recording_ref',  // Recording a DTW reference template
};

class GesturaApp {
    constructor() {
        this.state = State.IDLE;
        this.mode = 'recognize';     // 'recognize' or 'record'
        this.handTracker = new HandTracker();
        this.capture = new Capture();
        this.network = new Network();
        this.tts = new TTS();
        this.asr = null;  // Initialized after connection

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

        // DOM refs — mode toggle
        this.modeRecognize = document.getElementById('mode-recognize');
        this.modeRecord = document.getElementById('mode-record');
        this.recognizeContent = document.getElementById('recognize-content');
        this.recordContent = document.getElementById('record-content');

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
                // Feed landmarks to capture module when capturing
                if (this.state === State.CAPTURING || this.state === State.RECORDING_REF) {
                    this.capture.addFrame(hands);
                }
            });

            this.handTracker.start();
            this.btnCapture.disabled = false;
            console.log('[Gestura] Hand tracker ready');
        } catch (err) {
            console.error('[Gestura] Hand tracker init failed:', err);
            this._showError('Camera access failed. Grant permission and reload.');
            return;
        }

        // ── Initialize ASR ──
        this.asr = new ASR(this.network);
        this.asr.onResult = (text, isFinal) => {
            this._updateCaption(text);
        };
        this.asr.onStatusChange = (status) => {
            console.log('[ASR Status]', status);
        };

        const asrMode = await this.asr.init();
        console.log(`[Gestura] ASR mode: ${asrMode}`);

        // Start listening for captions
        if (asrMode !== 'none') {
            await this.asr.startListening();
        }

        // ── Set up capture state callback ──
        this.capture.onStateChange = (isCapturing, frameCount) => {
            this._updateCaptureUI(isCapturing, frameCount);
        };

        // ── Bind button events ──
        this.btnCapture.addEventListener('click', () => this._handleCaptureToggle());

        // ── Alt suggestion click → accept alternate label ──
        this.altLabel.addEventListener('click', () => {
            const altText = this.altLabel.textContent;
            if (altText) {
                this._displayResult(altText, 1.0); // Show as accepted
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
    // Mode Switching
    // ──────────────────────────────────────────

    _switchMode(mode) {
        if (this.mode === mode) return;

        // Don't switch during active capture
        if (this.state === State.CAPTURING || this.state === State.RECORDING_REF) {
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
            this._startCapture();
        } else if (this.state === State.CAPTURING) {
            this._stopCaptureAndRecognize();
        }
    }

    _handleRecordToggle() {
        if (this.state === State.IDLE || this.state === State.RESULT) {
            this._startRecording();
        } else if (this.state === State.RECORDING_REF) {
            this._stopRecordingAndSave();
        }
    }

    _startCapture() {
        this.state = State.CAPTURING;
        this.capture.startCapture();
        this._clearResult();

        this.btnCapture.classList.add('capturing');
        this.btnCapture.innerHTML = '■';  // Stop icon
    }

    async _stopCaptureAndRecognize() {
        const request = this.capture.stopCapture();
        this.btnCapture.classList.remove('capturing');
        this.btnCapture.innerHTML = '●';  // Record icon

        if (!request || request.landmarks.length === 0) {
            this.state = State.IDLE;
            this._showError('No hand landmarks captured. Try again.');
            return;
        }

        // ── Processing state ──
        this.state = State.PROCESSING;
        this.processingIndicator.classList.add('visible');
        this.btnCapture.disabled = true;

        try {
            const response = await this.network.recognize(request);

            // ── Display result ──
            this.state = State.RESULT;
            this.processingIndicator.classList.remove('visible');
            this.btnCapture.disabled = false;

            if (response.error) {
                this._showError(response.error);
                return;
            }

            this._displayResult(response.label, response.confidence);

            // Show "Did you mean?" for low confidence
            if (response.confidence < 0.5 && response.alternate_label) {
                this._showAltSuggestion(response.alternate_label, response.alternate_confidence);
            }

            // Speak the result
            if (response.label && response.label !== 'unknown') {
                await this.tts.speakLabel(response.label);
            }

        } catch (err) {
            this.state = State.IDLE;
            this.processingIndicator.classList.remove('visible');
            this.btnCapture.disabled = false;
            this._showError(err.message);
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

            // Also fetch detailed template info via /api/templates/reload
            const reloadResponse = await this.network.reloadTemplates();

            if (reloadResponse && reloadResponse.signs) {
                this._renderTemplateCounts(reloadResponse.signs, reloadResponse.total_templates);
            }
        } catch (err) {
            console.warn('[Gestura] Could not load template counts:', err);
        }
    }

    _renderTemplateCounts(signs, total) {
        // Build chips for all vocabulary signs showing count
        const vocab = [
            'hello', 'thank_you', 'sorry', 'please', 'yes', 'no',
            'help', 'stop', 'water', 'food', 'eat', 'good', 'bad',
            'my_name', 'how_are_you'
        ];

        // signs is an array of sign names that have templates
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

    _updateCaption(text) {
        if (text) {
            this.captionText.textContent = text;
            this.captionText.classList.remove('hidden');
            this.captionPlaceholder.classList.add('hidden');
        }
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
