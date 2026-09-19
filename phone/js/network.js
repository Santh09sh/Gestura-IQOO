/**
 * Network — Server Communication
 * ─────────────────────────────────
 * All API calls use same-origin relative paths: /api/recognize, /api/transcribe, etc.
 * The reverse proxy (proxy.js) routes /api/* → Flask backend at localhost:5000.
 *
 * No hardcoded IPs, no localhost references, no http:// — everything is same-origin.
 * This eliminates CORS and mixed-content issues entirely.
 */

export class Network {
    constructor() {
        // All requests go to same origin via /api/* prefix
        this.apiBase = '/api';
        this.timeout = 10000; // 10 second timeout
    }

    /**
     * Send a recognition request to the server.
     * @param {Object} requestBody - Per GEMINI.md §1.1: {sign_id, landmarks}
     * @returns {Object} Response per GEMINI.md §1.2
     */
    async recognize(requestBody) {
        return this._post('/recognize', requestBody);
    }

    /**
     * Send audio for transcription (ASR fallback).
     * @param {Blob} audioBlob - Audio data
     * @returns {Object} {text, language, error}
     */
    async transcribe(audioBlob) {
        const url = `${this.apiBase}/transcribe`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);

        try {
            const response = await fetch(url, {
                method: 'POST',
                body: audioBlob,
                headers: { 'Content-Type': 'audio/webm' },
                signal: controller.signal,
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                throw new Error(`Server error: ${response.status}`);
            }

            return await response.json();
        } catch (err) {
            clearTimeout(timeoutId);
            return this._handleError(err);
        }
    }

    /**
     * Ping the server for health check.
     * @returns {Object} Per GEMINI.md §1.3
     */
    async ping() {
        const url = `${this.apiBase}/ping`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        try {
            const response = await fetch(url, { signal: controller.signal });
            clearTimeout(timeoutId);

            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return await response.json();
        } catch (err) {
            clearTimeout(timeoutId);
            throw err;
        }
    }

    /**
     * Save a DTW reference template on the server.
     * @param {string} signName - Name of the sign
     * @param {Array} landmarks - Landmark sequence to save as reference
     * @returns {Object} {status, saved, total_for_sign}
     */
    async saveTemplate(signName, landmarks) {
        return this._post('/templates/save', {
            sign: signName,
            landmarks: landmarks,
        });
    }

    /**
     * Reload DTW templates on the server.
     * @returns {Object} {status, signs, total_templates}
     */
    async reloadTemplates() {
        return this._post('/templates/reload', {});
    }

    async _post(path, body) {
        const url = `${this.apiBase}${path}`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
                signal: controller.signal,
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || `Server error: ${response.status}`);
            }

            return await response.json();
        } catch (err) {
            clearTimeout(timeoutId);
            throw this._wrapError(err);
        }
    }

    _wrapError(err) {
        if (err.name === 'AbortError') {
            return new Error('Request timed out. Is the server running?');
        }
        if (err.message.includes('Failed to fetch') || err.message.includes('NetworkError')) {
            return new Error('Cannot reach server. Check connection.');
        }
        return err;
    }

    _handleError(err) {
        console.error('[Network]', err);
        return { text: '', error: err.message };
    }

    /**
     * Network is always configured when using same-origin proxy.
     */
    get isConfigured() {
        return true;
    }
}
