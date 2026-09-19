# Gestura — Progress Log

> Chronological record of what was done, errors encountered, tests run, and results.

---

## Session: 2026-09-11

### Protocol 0: Initialization ✅

**Done:**
- Created `GEMINI.md` — project constitution with data schemas, behavioral rules, architecture, setup instructions
- Created `findings.md` — research summary, proposed vocabulary (15 signs), technical constraints, risk register
- Created `task_plan.md` — phased implementation plan with checklists
- Created `progress.md` — this file
- Reviewed existing project files: `gestura-core-rules.md`, workflow files (add-new-sign, test-connection, push-to-github)
- Confirmed data schema (request/response JSON format) and documented in GEMINI.md §1

**Research completed:**
- AI4Bharat INCLUDE: Transformer on 553 MediaPipe Holistic landmarks, 263 ISL word classes, MIT licensed, pretrained weights available
- **Key finding:** INCLUDE expects 553 landmarks (face + pose + hands); our browser captures 42 (hands only). DTW must be the reliable primary path for the prototype.
- MediaPipe Hand Landmarker: `@mediapipe/tasks-vision`, runs in-browser, 21 landmarks/hand, LIVE_STREAM mode
- Web Speech API: TTS is fully on-device; ASR may route to cloud on some browsers (documented as accepted limitation for web prototype)

**Decisions made:**
- DTW is the primary reliable path for the prototype demo
- AI4Bharat integration is experimental (zero-padding approach to be tested)
- Proposed vocabulary: 15 signs across greetings, common, emergency, basic needs categories — awaiting team confirmation

**No errors or tests yet — infrastructure phase only.**

---

## Session: 2026-09-11 (continued — Phase 2→3)

### Phase 2: Link ✅

**Built:**
- `server/requirements.txt` — Flask, flask-cors, numpy, dtaidistance, scipy, faster-whisper
- `server/app.py` — Flask server with `/ping`, CORS, binds `0.0.0.0:5000`
- `phone/index.html` — full-screen mobile page with connection test UI + server IP input
- `phone/style.css` — complete design system (dark, high-contrast, 20px+ body, 32px+ labels)

**Verified:**
- Server starts on `0.0.0.0:5000`
- `/ping` returns valid JSON: `{"status":"ok","dtw_ready":false,"model_loaded":false,"vocabulary_size":15}`
- LAN IP confirmed: `192.168.55.105`

### Phase 3A: Server Tools ✅

**Built:**
- `server/tools/landmark_normalizer.py` — 45-frame normalization (downsample/pad/passthrough)
- `server/tools/dtw_matcher.py` — DTW distance via dtaidistance + numpy fallback, 126-dim vectors (right+left), top-2 matches
- `server/tools/asr_handler.py` — faster-whisper local transcription (lazy-loaded, CPU int8)
- `server/tools/test_tools.py` — 20 tests, all passing

**Test results:**
- 20/20 passed in 1.06s
- Confidence separation check: correct match scores meaningfully higher than wrong match (gap > 0.1) ✅
- Normalizer handles all edge cases: 1→45, 20→45, 45→45, 90→45, 200→45, empty, two-handed

### Phase 3B: Server Navigation ✅

**Built:**
- `POST /recognize` — validates schema, normalizes landmarks, runs DTW, returns response per GEMINI.md §1.2
- `POST /transcribe` — accepts audio, runs through faster-whisper
- `POST /templates/save` — saves new DTW reference template
- `POST /templates/reload` — reloads templates from disk

**Verified:**
- `/recognize` returns correct "no templates" response when dtw_references/ is empty
- Response schema matches GEMINI.md §1.2 (sign_id echoed, source="dtw")

### Phase 3C: Phone Capture ✅

**Built:**
- `phone/js/hand_tracker.js` — MediaPipe Hand Landmarker (VIDEO mode, numHands=2, landmark overlay)
- `phone/js/capture.js` — frame buffering with start/stop, packages to GEMINI.md §1.1 schema
- `phone/js/network.js` — /recognize, /transcribe, /templates/save, /templates/reload
- `phone/js/main.js` — app controller, state machine (idle→capturing→processing→result)

### Phase 3D: Phone Output ✅

**Built:**
- `phone/js/tts.js` — speechSynthesis with `voice.localService === true` filter
- `phone/js/asr.js` — processLocally=true first, server /transcribe fallback, never ships cloud config

**Decision: AI4Bharat deferred** — zero-padding 42 hand landmarks into 553-dim vector would produce mostly meaningless zeros. DTW is the real primary path. AI4Bharat only revisitable with proper pose landmark extraction.

### Phase 4: In Progress

**Remaining:**
- Record Reference mode UI (so DTW templates can be captured)
- End-to-end manual verification on actual phone
- Airplane mode ASR test

---
