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
        this.handTracker = new HandTracker();
        this.capture = new Capture();
        this.network = new Network();
        this.tts = new TTS();
        this.asr = null;  // Initialized after connection

        // DOM refs
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

        console.log('[Gestura] App ready');
    }

    // ──────────────────────────────────────────
    // State Transitions
    // ──────────────────────────────────────────

    _handleCaptureToggle() {
        if (this.state === State.IDLE || this.state === State.RESULT) {
            this._startCapture();
        } else if (this.state === State.CAPTURING) {
            this._stopCaptureAndRecognize();
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
