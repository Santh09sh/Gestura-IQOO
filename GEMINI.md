# Gestura — Project Constitution

> This file is the single source of truth for schemas, behavioral rules, and architectural invariants.
> Every agent, script, and contributor must obey this document. If it contradicts a code comment, this wins.

---

## 1. Data Schemas

### 1.1 Recognition Request (Phone → Laptop)

```json
{
  "sign_id": "string (UUID v4 or ISO-8601 timestamp)",
  "landmarks": [
    {
      "frame": 0,
      "hand": "right",
      "points": [
        [0.123, 0.456, 0.789],
        "... 21 entries, each [x, y, z] normalized 0–1"
      ]
    },
    {
      "frame": 0,
      "hand": "left",
      "points": [
        [0.111, 0.222, 0.333],
        "... 21 entries (only present if two hands detected)"
      ]
    },
    {
      "frame": 1,
      "hand": "right",
      "points": ["... 21 entries"]
    }
  ]
}
```

**Rules:**
- `sign_id` must be unique per capture event. Use `crypto.randomUUID()` on the phone side.
- `landmarks` is ordered by ascending `frame` number.
- Each frame contains 1 or 2 hand entries (`"right"` and/or `"left"`).
- Each `points` array has exactly 21 entries in MediaPipe Hand Landmarker order (WRIST=0 through PINKY_TIP=20).
- Coordinates are normalized: x,y ∈ [0,1] relative to image dimensions; z is depth relative to wrist.
- Before classification, the server normalizes the sequence to exactly **45 frames** by uniform temporal sampling (if longer) or last-frame padding (if shorter).

### 1.2 Recognition Response (Laptop → Phone)

```json
{
  "sign_id": "same-uuid-echoed-back",
  "label": "hello",
  "confidence": 0.87,
  "alternate_label": "thank_you",
  "alternate_confidence": 0.09,
  "source": "ai4bharat"
}
```

**Rules:**
- `sign_id` must exactly match the request's `sign_id`.
- `label` is the top-1 predicted sign from the vocabulary.
- `confidence` ∈ [0, 1].
- `alternate_label` and `alternate_confidence` are the second-best prediction.
- `source` is always one of: `"ai4bharat"` or `"dtw"`. Never omitted, never ambiguous.
- If confidence < 0.5, the phone UI shows a "Did you mean?" prompt with both candidates.

### 1.3 Ping (Health Check)

**Request:** `GET /ping`
**Response:**
```json
{
  "status": "ok",
  "server_time": "2026-09-11T16:00:00+05:30",
  "model_loaded": true,
  "dtw_ready": true,
  "vocabulary_size": 15
}
```

---

## 2. Behavioral Rules (Hard Constraints)

These are **non-negotiable**. They override convenience, speed, and personal preference.

### 2.1 Zero Cloud Dependency
- **NEVER** call a cloud API for recognition, transcription, translation, or speech synthesis.
- This applies to every path: production, debug, "just to test", fallback. No exceptions.
- If a library silently phones home, it's a disqualifying bug.
- On Android: use `SpeechRecognizer.createOnDeviceSpeechRecognizer(Context)` specifically. Check `isOnDeviceRecognitionAvailable()` before relying on it. Never use the generic `createSpeechRecognizer()`.

### 2.2 Fixed Vocabulary
- 15–20 signs, defined in `findings.md`. Do not add signs without explicit team instruction.
- Adding a 21st sign is an error to flag, not a feature to ship.

### 2.3 Isolated Sign Capture Only
- Pause-or-tap to mark the end of a sign. No continuous/fluent sequence recognition.
- This is a deliberate scope decision, not an oversight to fix.

### 2.4 No Generated Media
- No synthetic video, images, or avatar output anywhere. Real camera frames and real text captions only.
- The reverse direction (speech → sign) is captions-only, by team decision.

### 2.5 Dual Recognition Paths
- DTW fallback must always be functional, independent of whether AI4Bharat integration is complete.
- Both paths normalize to 45 frames before classification.
- Response payloads always include `"source"` to identify which path produced the result.

### 2.6 Frame Normalization
- Every sign sequence is normalized to exactly 45 frames before reaching any classifier.
- Longer sequences: uniform temporal sampling (pick every N-th frame).
- Shorter sequences: repeat the last frame to pad up to 45.

---

## 3. Architecture

### 3.1 Three-Layer Architecture

```
┌─────────────────────────────────────────────────┐
│ ARCHITECTURE LAYER                              │
│ Written SOPs: PRD, Architecture doc, Build Guide│
│ If present in repo → authoritative, don't       │
│ contradict.                                     │
└──────────────────────┬──────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────┐
│ NAVIGATION LAYER                                │
│ Flask/FastAPI server — thin routing only         │
│ /ping  → health check                           │
│ /recognize → dispatch to AI4Bharat or DTW       │
│ Dispatches, doesn't reason.                     │
└──────────────────────┬──────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────┐
│ TOOLS LAYER                                     │
│ Atomic, testable scripts:                       │
│ • landmark_normalizer.py  (45-frame norm)       │
│ • ai4bharat_inference.py  (model wrapper)       │
│ • dtw_matcher.py          (template matching)   │
│ • tts_trigger.js          (on-device speech)    │
│ • asr_trigger.js          (on-device transcribe)│
│ Each independently testable with fixtures.      │
└─────────────────────────────────────────────────┘
```

### 3.2 Component Map

```
gestura-prototype/
├── GEMINI.md               ← this file (constitution)
├── task_plan.md             ← phases and checklists
├── findings.md              ← research, vocabulary, constraints
├── progress.md              ← session log
├── server/
│   ├── app.py               ← Flask/FastAPI entry point (Navigation layer)
│   ├── requirements.txt
│   └── tools/
│       ├── landmark_normalizer.py
│       ├── ai4bharat_inference.py
│       ├── dtw_matcher.py
│       └── test_tools.py
├── phone/
│   ├── index.html           ← Full-screen mobile web app
│   ├── style.css            ← High-contrast, large-text, minimal animation
│   ├── js/
│   │   ├── main.js          ← App controller
│   │   ├── hand_tracker.js  ← MediaPipe Hand Landmarker wrapper
│   │   ├── capture.js       ← Landmark sequence capture logic
│   │   ├── network.js       ← Server communication
│   │   ├── tts.js           ← On-device text-to-speech
│   │   └── asr.js           ← On-device speech recognition (captions)
│   └── assets/
│       └── hand_landmarker.task  ← MediaPipe model bundle (downloaded, not committed)
├── dtw_references/
│   └── (sign_name)_01.json  ← Recorded reference landmarks per sign
├── models/
│   └── (AI4Bharat pretrained weights, downloaded, not committed)
└── .gitignore
```

### 3.3 Technology Choices

| Component | Technology | Rationale |
|-----------|-----------|-----------|
| Phone UI | Mobile web page (HTML/CSS/JS) | No native Android setup yet; browser gives camera access via `getUserMedia()` |
| Hand tracking | `@mediapipe/tasks-vision` HandLandmarker | Runs entirely in-browser, 21 landmarks/hand, no server call |
| Server | Python (Flask or FastAPI) | AI4Bharat's code is Python; keeps inference in same runtime |
| AI4Bharat model | Transformer on extracted landmarks | Pretrained on INCLUDE dataset (263 ISL word classes), MIT licensed |
| DTW fallback | `dtaidistance` or `fastdtw` Python library | Classic DTW on hand landmark sequences, no training needed |
| TTS (phone) | Web Speech API `speechSynthesis` | On-device, no cloud call, built into all modern mobile browsers |
| ASR (phone) | Web Speech API `SpeechRecognition` | On-device where available; for Android native later, use `createOnDeviceSpeechRecognizer()` |
| Phone ↔ Laptop | HTTP over local WiFi | Both devices on same network, server binds to LAN IP |

---

## 4. Local Setup (Maintenance Reference)

### 4.1 Prerequisites
- Python 3.9+ on the laptop
- Node.js (optional, only if using a dev server for the phone app — otherwise just serve static files)
- Both phone and laptop on the same WiFi network

### 4.2 Laptop Server Setup
```bash
cd server/
pip install -r requirements.txt
# Download AI4Bharat pretrained weights (one-time):
# python download_model.py
python app.py --host 0.0.0.0 --port 5000
```

### 4.3 Phone App Setup
```bash
# Serve phone/ directory over HTTPS (required for getUserMedia):
# Option A: Python's built-in server (HTTP only — works on localhost, not over WiFi)
# Option B: Use a tool like mkcert + a simple HTTPS server
cd phone/
npx serve --ssl-cert cert.pem --ssl-key key.pem --listen 8443
```
Then open `https://<laptop-ip>:8443` on the phone browser.

### 4.4 Connection Verification
1. Confirm both devices on same WiFi.
2. Get laptop IP: `ipconfig` → IPv4 under active WiFi adapter.
3. Phone browser → `http://<laptop-ip>:5000/ping` → should return JSON with `"status": "ok"`.
4. If it fails: check Windows Firewall (allow port 5000), confirm same network, try disabling guest isolation on router.

### 4.5 Full Round Trip Test
1. Phone app captures hand landmarks → taps "Capture"
2. Landmark sequence sent to `http://<laptop-ip>:5000/recognize`
3. Server responds with label + confidence
4. Phone speaks the label via TTS and displays result

---

## 5. AI4Bharat INCLUDE Integration Notes

- **Repository:** github.com/AI4Bharat/INCLUDE
- **License:** MIT
- **Model type:** Transformer on extracted landmarks (553 total from MediaPipe Holistic; we use 21 hand landmarks per hand → 42 max)
- **Dataset:** 263 ISL word classes, but we only use our 15–20 sign subset
- **Key scripts:** `runner.py` (training/inference), `generate_keypoints.py` (landmark extraction)
- **Inference:** `python runner.py --dataset include --use_augs --model transformer --data_dir <keypoints> --use_pretrained evaluate`
- **Label map:** `label_map.json` maps sign words to class IDs
- **Our approach:** Extract the model weights, wrap inference in `ai4bharat_inference.py`, accept our normalized 45-frame landmark sequences as input, filter output to our vocabulary subset

---

*Last updated: 2026-09-11*
