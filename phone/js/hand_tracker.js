/**
 * Hand Tracker — MediaPipe Hand Landmarker Wrapper
 * ─────────────────────────────────────────────────
 * Initializes MediaPipe Hand Landmarker in LIVE_STREAM mode,
 * processes video frames, extracts 21 landmarks per hand,
 * and draws landmark overlay on a canvas.
 *
 * Uses @mediapipe/tasks-vision (current API, not deprecated @mediapipe/hands).
 */

const MEDIAPIPE_CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm';

// Landmark connections for drawing (MediaPipe Hand Landmarker order)
const HAND_CONNECTIONS = [
    [0, 1], [1, 2], [2, 3], [3, 4],       // Thumb
    [0, 5], [5, 6], [6, 7], [7, 8],       // Index
    [0, 9], [9, 10], [10, 11], [11, 12],   // Middle
    [0, 13], [13, 14], [14, 15], [15, 16], // Ring
    [0, 17], [17, 18], [18, 19], [19, 20], // Pinky
    [5, 9], [9, 13], [13, 17],             // Palm
];

export class HandTracker {
    constructor() {
        this.handLandmarker = null;
        this.video = null;
        this.canvas = null;
        this.ctx = null;
        this.isRunning = false;
        this.onResults = null;           // Callback: (landmarks) => {}
        this.lastTimestamp = -1;
        this._animFrameId = null;
    }

    /**
     * Initialize the hand landmarker and start camera.
     * @param {HTMLVideoElement} videoEl - Video element for camera feed
     * @param {HTMLCanvasElement} canvasEl - Canvas for landmark overlay
     * @param {Function} onResults - Callback receiving landmarks per frame
     */
    async init(videoEl, canvasEl, onResults) {
        this.video = videoEl;
        this.canvas = canvasEl;
        this.ctx = canvasEl.getContext('2d');
        this.onResults = onResults;

        // Load MediaPipe Vision module
        const { HandLandmarker, FilesetResolver } = await import(
            'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest'
        );

        const vision = await FilesetResolver.forVisionTasks(MEDIAPIPE_CDN);

        this.handLandmarker = await HandLandmarker.createFromOptions(vision, {
            baseOptions: {
                modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task',
                delegate: 'GPU',
            },
            runningMode: 'VIDEO',   // We'll call detectForVideo() in our own loop
            numHands: 2,
            minHandDetectionConfidence: 0.5,
            minHandPresenceConfidence: 0.5,
            minTrackingConfidence: 0.5,
        });

        // Start camera
        await this._startCamera();
    }

    async _startCamera() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: 'user',
                    width: { ideal: 640 },
                    height: { ideal: 480 },
                },
                audio: false,
            });

            this.video.srcObject = stream;
            await this.video.play();

            // Match canvas to video dimensions
            this.canvas.width = this.video.videoWidth;
            this.canvas.height = this.video.videoHeight;

            // Hide placeholder
            const placeholder = document.getElementById('video-placeholder');
            if (placeholder) placeholder.classList.add('hidden');

        } catch (err) {
            console.error('[HandTracker] Camera access failed:', err);
            throw new Error(
                'Camera access denied. Ensure HTTPS and grant camera permission.'
            );
        }
    }

    /**
     * Start processing frames.
     */
    start() {
        if (this.isRunning) return;
        this.isRunning = true;
        this._processFrame();
    }

    /**
     * Stop processing frames.
     */
    stop() {
        this.isRunning = false;
        if (this._animFrameId) {
            cancelAnimationFrame(this._animFrameId);
            this._animFrameId = null;
        }
    }

    _processFrame() {
        if (!this.isRunning || !this.handLandmarker) return;

        const now = performance.now();
        if (now <= this.lastTimestamp) {
            this._animFrameId = requestAnimationFrame(() => this._processFrame());
            return;
        }
        this.lastTimestamp = now;

        // Detect hands
        const results = this.handLandmarker.detectForVideo(this.video, now);

        // Clear canvas
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        if (results.landmarks && results.landmarks.length > 0) {
            // Draw landmarks for each hand
            for (let i = 0; i < results.landmarks.length; i++) {
                const landmarks = results.landmarks[i];
                const handedness = results.handednesses[i]?.[0]?.categoryName || 'Right';
                const isRight = handedness === 'Right';

                this._drawLandmarks(landmarks, isRight);
            }

            // Notify callback with structured data
            if (this.onResults) {
                const structured = this._structureResults(results);
                this.onResults(structured);
            }
        }

        this._animFrameId = requestAnimationFrame(() => this._processFrame());
    }

    /**
     * Convert MediaPipe results to our landmark format.
     * Returns array of {hand: "right"|"left", points: [[x,y,z],...]}
     */
    _structureResults(results) {
        const hands = [];

        for (let i = 0; i < results.landmarks.length; i++) {
            const landmarks = results.landmarks[i];
            // MediaPipe labels from camera perspective — "Right" in MediaPipe
            // means the person's right hand (mirrored in selfie view)
            const handedness = results.handednesses[i]?.[0]?.categoryName || 'Right';

            const points = landmarks.map(lm => [lm.x, lm.y, lm.z]);

            hands.push({
                hand: handedness.toLowerCase(),
                points: points,
            });
        }

        return hands;
    }

    /**
     * Draw hand landmarks and connections on the canvas.
     */
    _drawLandmarks(landmarks, isRight) {
        const w = this.canvas.width;
        const h = this.canvas.height;

        // Unified accent teal — no per-hand color distinction
        const dotColor = '#5EAE9B';
        const lineColor = 'rgba(94, 174, 155, 0.45)';

        // Draw connections
        this.ctx.strokeStyle = lineColor;
        this.ctx.lineWidth = 2;
        for (const [start, end] of HAND_CONNECTIONS) {
            const s = landmarks[start];
            const e = landmarks[end];
            this.ctx.beginPath();
            this.ctx.moveTo(s.x * w, s.y * h);
            this.ctx.lineTo(e.x * w, e.y * h);
            this.ctx.stroke();
        }

        // Draw landmark points
        this.ctx.fillStyle = dotColor;
        for (const lm of landmarks) {
            this.ctx.beginPath();
            this.ctx.arc(lm.x * w, lm.y * h, 4, 0, 2 * Math.PI);
            this.ctx.fill();
        }
    }

    /**
     * Check if hands are currently detected.
     */
    get hasHands() {
        return this.isRunning;
    }

    /**
     * Clean up resources.
     */
    destroy() {
        this.stop();
        if (this.video?.srcObject) {
            this.video.srcObject.getTracks().forEach(t => t.stop());
        }
    }
}
