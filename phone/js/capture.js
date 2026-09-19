/**
 * Capture — Landmark Sequence Capture Logic
 * ──────────────────────────────────────────
 * Buffers landmark frames while user is signing.
 * "Capture" button marks end of sign.
 * Packages buffered frames into request JSON per GEMINI.md §1.1.
 * Generates sign_id via crypto.randomUUID().
 */

export class Capture {
    constructor() {
        this.frames = [];           // Array of {hands: [{hand, points}]}
        this.isCapturing = false;
        this.frameCount = 0;
        this.onStateChange = null;  // Callback: (isCapturing, frameCount) => {}
    }

    /**
     * Start capturing landmark frames.
     */
    startCapture() {
        this.frames = [];
        this.frameCount = 0;
        this.isCapturing = true;
        this._notifyState();
    }

    /**
     * Stop capturing and return the packaged request.
     * @returns {Object|null} Request body per GEMINI.md §1.1, or null if no frames captured
     */
    stopCapture() {
        this.isCapturing = false;
        this._notifyState();

        if (this.frames.length === 0) {
            return null;
        }

        return this._packageRequest();
    }

    /**
     * Add a frame of landmark data from the hand tracker.
     * Called on every frame while capturing.
     * @param {Array} hands - Array of {hand: "right"|"left", points: [[x,y,z],...]}
     */
    addFrame(hands) {
        if (!this.isCapturing || !hands || hands.length === 0) return;

        this.frames.push({
            frameIndex: this.frameCount,
            hands: hands,
        });
        this.frameCount++;
        this._notifyState();
    }

    /**
     * Package captured frames into the request format per GEMINI.md §1.1.
     * @returns {Object} {sign_id, landmarks: [{frame, hand, points}, ...]}
     */
    _packageRequest() {
        const signId = crypto.randomUUID();
        const landmarks = [];

        for (const frame of this.frames) {
            for (const hand of frame.hands) {
                landmarks.push({
                    frame: frame.frameIndex,
                    hand: hand.hand,
                    points: hand.points,
                });
            }
        }

        return {
            sign_id: signId,
            landmarks: landmarks,
        };
    }

    _notifyState() {
        if (this.onStateChange) {
            this.onStateChange(this.isCapturing, this.frameCount);
        }
    }

    /**
     * Reset capture state without generating a request.
     */
    reset() {
        this.frames = [];
        this.frameCount = 0;
        this.isCapturing = false;
        this._notifyState();
    }
}
