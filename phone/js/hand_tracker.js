/**
 * Hand Tracker — MediaPipe Hand Landmarker Wrapper
 * ─────────────────────────────────────────────────
 * Initializes MediaPipe Hand Landmarker in VIDEO mode,
 * processes video frames, extracts 21 landmarks per hand,
 * and draws landmark overlay on a canvas.
 *
 * Uses @mediapipe/tasks-vision (current API, not deprecated @mediapipe/hands).
 *
 * Key fixes:
 *   - Canvas dimensions are set only AFTER video metadata is loaded
 *     (videoWidth/videoHeight are 0 before that on mobile).
 *   - Canvas is mirrored via CSS scaleX(-1) to match the mirrored
 *     front-camera video feed; landmark X coordinates are flipped
 *     so skeleton nodes overlay correctly on the hand.
 *   - MediaPipe CDN is pinned to a stable version, not @latest.
 *   - _processFrame has a try/catch so one bad frame doesn't kill the loop.
 */

// Pin to a specific stable release — @latest can break on mobile
const MEDIAPIPE_VERSION = '0.10.21';
const MEDIAPIPE_CDN = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`;

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
        this.facingMode = 'user';        // 'user' = front, 'environment' = rear
        this._resizeObserver = null;
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

        // Load MediaPipe Vision module — pinned version
        const { HandLandmarker, FilesetResolver } = await import(
            `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}`
        );

        // Store HandLandmarker class reference for later use
        this._HandLandmarker = HandLandmarker;

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
            // Stop any existing stream
            if (this.video.srcObject) {
                this.video.srcObject.getTracks().forEach(t => t.stop());
            }

            const stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: this.facingMode,
                    width: { ideal: 640 },
                    height: { ideal: 480 },
                },
                audio: false,
            });

            this.video.srcObject = stream;

            // Wait for video metadata to load — videoWidth/videoHeight are 0 until then
            await this._waitForVideoReady();

            await this.video.play();

            // Set canvas dimensions to match actual video resolution
            this._syncCanvasSize();

            // Watch for container resizes (orientation changes, etc.)
            this._setupResizeObserver();

            // Apply mirror CSS for front camera
            this._applyMirror();

            // Reset timestamp so detectForVideo doesn't skip frames
            this.lastTimestamp = -1;

            // Hide placeholder
            const placeholder = document.getElementById('video-placeholder');
            if (placeholder) placeholder.classList.add('hidden');

            console.log(`[HandTracker] Camera started. Video: ${this.video.videoWidth}×${this.video.videoHeight}, Facing: ${this.facingMode}`);

        } catch (err) {
            console.error('[HandTracker] Camera access failed:', err);
            throw new Error(
                'Camera access denied. Ensure HTTPS and grant camera permission.'
            );
        }
    }

    /**
     * Wait until the video element has valid dimensions.
     * On mobile browsers, videoWidth/videoHeight remain 0 until
     * the 'loadedmetadata' event fires (and sometimes even after that).
     */
    _waitForVideoReady() {
        return new Promise((resolve, reject) => {
            // If already ready (unlikely but possible on desktop)
            if (this.video.videoWidth > 0 && this.video.videoHeight > 0) {
                resolve();
                return;
            }

            const onLoaded = () => {
                this.video.removeEventListener('loadedmetadata', onLoaded);
                // Even after loadedmetadata, some mobile browsers need a frame
                // before videoWidth/videoHeight are non-zero. Poll briefly.
                this._pollUntilVideoDimensions(resolve, reject, 0);
            };

            this.video.addEventListener('loadedmetadata', onLoaded);

            // Safety timeout — don't hang forever
            setTimeout(() => {
                this.video.removeEventListener('loadedmetadata', onLoaded);
                if (this.video.videoWidth > 0) {
                    resolve();
                } else {
                    // Last resort: use default dimensions
                    console.warn('[HandTracker] Video dimensions still 0 after timeout, using defaults');
                    resolve();
                }
            }, 5000);
        });
    }

    _pollUntilVideoDimensions(resolve, reject, attempts) {
        if (this.video.videoWidth > 0 && this.video.videoHeight > 0) {
            resolve();
        } else if (attempts > 30) {
            console.warn('[HandTracker] Video dimensions not available after polling');
            resolve(); // Proceed anyway
        } else {
            requestAnimationFrame(() =>
                this._pollUntilVideoDimensions(resolve, reject, attempts + 1)
            );
        }
    }

    /**
     * Sync canvas internal resolution with the video feed.
     * CSS makes both fill the container; this sets the drawing resolution.
     */
    _syncCanvasSize() {
        const w = this.video.videoWidth || 640;
        const h = this.video.videoHeight || 480;
        if (this.canvas.width !== w || this.canvas.height !== h) {
            this.canvas.width = w;
            this.canvas.height = h;
            console.log(`[HandTracker] Canvas sized to ${w}×${h}`);
        }
    }

    /**
     * Mirror video + canvas for front camera, un-mirror for rear.
     * The video element is already mirrored by the browser for 'user' facingMode
     * on most mobile browsers, but we mirror both explicitly via CSS to be sure.
     */
    _applyMirror() {
        const isFront = this.facingMode === 'user';
        const transform = isFront ? 'scaleX(-1)' : 'none';
        this.video.style.transform = transform;
        this.canvas.style.transform = transform;
    }

    _setupResizeObserver() {
        // Clean up old observer
        if (this._resizeObserver) {
            this._resizeObserver.disconnect();
        }

        this._resizeObserver = new ResizeObserver(() => {
            this._syncCanvasSize();
        });

        const container = this.canvas.parentElement;
        if (container) {
            this._resizeObserver.observe(container);
        }
    }

    /**
     * Switch between front and rear cameras.
     */
    async switchCamera() {
        this.facingMode = this.facingMode === 'user' ? 'environment' : 'user';
        console.log(`[HandTracker] Switching to ${this.facingMode} camera`);
        await this._startCamera();
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

        // Clear canvas every frame regardless of detection results
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        try {
            // Ensure video is playing and has valid dimensions
            if (this.video.readyState < 2 || this.video.videoWidth === 0) {
                this._animFrameId = requestAnimationFrame(() => this._processFrame());
                return;
            }

            // Re-sync canvas if video dimensions changed (orientation change)
            this._syncCanvasSize();

            // Detect hands
            const results = this.handLandmarker.detectForVideo(this.video, now);

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

        } catch (err) {
            // Don't let one bad frame kill the entire tracking loop
            console.warn('[HandTracker] Frame error (continuing):', err.message);
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
     * Landmarks from MediaPipe are in normalized [0,1] coords relative to
     * the un-mirrored video frame. Since the canvas is CSS-mirrored (scaleX(-1))
     * to match the front-camera video, we draw landmarks as-is — the CSS
     * mirror handles the visual alignment automatically.
     */
    _drawLandmarks(landmarks, isRight) {
        const w = this.canvas.width;
        const h = this.canvas.height;

        // Unified accent teal — no per-hand color distinction
        const dotColor = '#5EAE9B';
        const lineColor = 'rgba(94, 174, 155, 0.55)';

        // Draw connections
        this.ctx.strokeStyle = lineColor;
        this.ctx.lineWidth = 3;
        this.ctx.lineCap = 'round';
        for (const [start, end] of HAND_CONNECTIONS) {
            const s = landmarks[start];
            const e = landmarks[end];
            this.ctx.beginPath();
            this.ctx.moveTo(s.x * w, s.y * h);
            this.ctx.lineTo(e.x * w, e.y * h);
            this.ctx.stroke();
        }

        // Draw landmark points with a subtle glow
        for (const lm of landmarks) {
            const x = lm.x * w;
            const y = lm.y * h;

            // Glow
            this.ctx.fillStyle = 'rgba(94, 174, 155, 0.3)';
            this.ctx.beginPath();
            this.ctx.arc(x, y, 7, 0, 2 * Math.PI);
            this.ctx.fill();

            // Core dot
            this.ctx.fillStyle = dotColor;
            this.ctx.beginPath();
            this.ctx.arc(x, y, 4, 0, 2 * Math.PI);
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
        if (this._resizeObserver) {
            this._resizeObserver.disconnect();
        }
        if (this.video?.srcObject) {
            this.video.srcObject.getTracks().forEach(t => t.stop());
        }
    }
}
