# Gestura — Task Plan

> Phased implementation plan following the B.L.A.S.T. protocol.
> Each phase has a gate — do not proceed to the next phase until the gate is passed.

---

## Phase 1: Blueprint ✅

**Goal:** Confirm the architecture, data schema, vocabulary, and research are documented and understood.

- [x] Create `GEMINI.md` with data schemas and behavioral rules
- [x] Create `findings.md` with research, vocabulary, and constraints
- [x] Create `progress.md` for session logging
- [x] Create this `task_plan.md`
- [x] Review existing project files (core rules, workflows)
- [x] Research AI4Bharat INCLUDE model structure and integration approach
- [x] Research MediaPipe Hand Landmarker browser API
- [x] Identify gap: INCLUDE expects 553 landmarks, we provide 42 → DTW is primary
- [ ] **BLOCKED:** Get team confirmation on the 15-sign vocabulary in `findings.md`

**Gate:** All documents created. Vocabulary confirmed by team. Schema in GEMINI.md is the contract.

---

## Phase 2: Link

**Goal:** Verify phone ↔ laptop connectivity before writing recognition logic.

- [ ] Set up Python server skeleton (`server/app.py`)
- [ ] Implement `/ping` endpoint returning health JSON (per GEMINI.md §1.3)
- [ ] Start server on `0.0.0.0:5000`
- [ ] Create minimal phone-side HTML page (`phone/index.html`)
- [ ] Phone page has a "Test Connection" button that hits `/ping`
- [ ] Confirm response displays on phone — **both devices on same WiFi**
- [ ] Handle failure: document firewall, IP, network-isolation troubleshooting in `progress.md`
- [ ] Log result in `progress.md`

**Gate:** Phone hits `/ping`, gets JSON response, displayed on screen. No recognition logic yet.

---

## Phase 3: Architect

**Goal:** Build the server's recognition pipeline (Navigation + Tools layers) and the phone's capture pipeline.

### 3A: Server — Tools Layer (atomic scripts, tested independently)

- [ ] `server/tools/landmark_normalizer.py` — normalize any-length landmark sequence to 45 frames
  - [ ] Unit test: sequence of 90 frames → 45 frames (downsampled)
  - [ ] Unit test: sequence of 20 frames → 45 frames (padded)
  - [ ] Unit test: sequence of exactly 45 frames → unchanged

- [ ] `server/tools/dtw_matcher.py` — DTW template matching
  - [ ] Load reference templates from `dtw_references/`
  - [ ] Compute DTW distance between input and all templates
  - [ ] Return top-2 matches with confidence scores
  - [ ] Unit test with synthetic fixtures

- [ ] `server/tools/ai4bharat_inference.py` — INCLUDE model wrapper
  - [ ] Download pretrained weights (document process)
  - [ ] Wrap inference: accept 45-frame hand landmarks → output class label + confidence
  - [ ] Handle the 42→553 landmark mapping (zero-padding face/pose)
  - [ ] Filter output to our vocabulary subset
  - [ ] If model fails to load or accuracy is poor → return graceful error so DTW takes over

- [ ] `server/tools/test_tools.py` — test harness
  - [ ] Test landmark_normalizer with edge cases
  - [ ] Test dtw_matcher with known fixtures
  - [ ] Test ai4bharat_inference (or skip gracefully if model not downloaded)

### 3B: Server — Navigation Layer (thin routing)

- [ ] `server/app.py` — Flask/FastAPI app
  - [ ] `POST /recognize` endpoint
    - [ ] Validate request body against GEMINI.md §1.1 schema
    - [ ] Normalize landmarks to 45 frames
    - [ ] Attempt AI4Bharat inference → if success and confidence > threshold, return it
    - [ ] Fallback to DTW → return result with `"source": "dtw"`
    - [ ] Return response per GEMINI.md §1.2 schema
  - [ ] Keep `/ping` from Phase 2
  - [ ] CORS headers (phone page served from different origin/port)
  - [ ] Bind to `0.0.0.0` so phone can reach it over WiFi

### 3C: Phone — Hand Tracking & Capture

- [ ] `phone/js/hand_tracker.js` — MediaPipe Hand Landmarker wrapper
  - [ ] Initialize HandLandmarker in LIVE_STREAM mode
  - [ ] Process video frames, extract 21 landmarks per hand
  - [ ] Draw landmark overlay on canvas (visual feedback)

- [ ] `phone/js/capture.js` — Sequence capture
  - [ ] Buffer landmark frames while user is signing
  - [ ] "Capture" button (or pause detection) to mark end of sign
  - [ ] Package buffered frames into request JSON (per GEMINI.md §1.1)
  - [ ] Generate `sign_id` via `crypto.randomUUID()`

- [ ] `phone/js/network.js` — Server communication
  - [ ] Send captured landmarks to `http://<server-ip>:5000/recognize`
  - [ ] Parse response
  - [ ] Handle network errors gracefully

### 3D: Phone — Output

- [ ] `phone/js/tts.js` — Speak recognized label via `speechSynthesis`
  - [ ] Only trigger on successful recognition
  - [ ] Configurable voice/rate

- [ ] `phone/js/asr.js` — On-device speech recognition for captions
  - [ ] Continuous listening mode
  - [ ] Display transcribed text as on-screen captions
  - [ ] Note limitation: may use cloud on some browsers

**Gate:** Server `/recognize` returns correct labels for test fixtures. Phone captures landmarks, sends them, gets a response, speaks it, displays it.

---

## Phase 3E: NLU — Sentence Formation Pipeline

**Goal:** Convert accumulated sign keywords into natural, spoken sentences using a local LLM.

### Server Side

- [ ] `server/tools/sentence_former.py` — Ollama LLM wrapper
  - [ ] Connect to Ollama REST API (`http://localhost:11434/api/generate`)
  - [ ] Prompt engineering: system prompt constrains output to natural ISL-to-English conversion
  - [ ] Accept array of sign labels → return formed sentence
  - [ ] Graceful fallback: if Ollama is unreachable, return signs joined with spaces
  - [ ] Response includes `source` field: `"ollama"` or `"fallback"`
  - [ ] Unit tests with mock Ollama responses

- [ ] `server/app.py` — new endpoint
  - [ ] `POST /form-sentence` — accepts `{signs: [...], context: "conversation"}`
  - [ ] Returns `{sentence: "...", signs: [...], source: "ollama", model: "gemma2:2b"}`
  - [ ] Update `/ping` to include `ollama_ready` and `ollama_model` fields

### Phone Side

- [ ] Sign buffer in `main.js`
  - [ ] Accumulate recognized signs into an ordered array (max 10)
  - [ ] Auto-trigger sentence formation after 3s timeout (no new sign detected)
  - [ ] Manual "Speak" button to trigger sentence formation early
  - [ ] Clear buffer after sentence is spoken

- [ ] `network.js` — new API call
  - [ ] `formSentence(signs)` → POST to `/api/form-sentence`

- [ ] UI updates
  - [ ] Show accumulated sign chips/badges in caption area
  - [ ] Display the formed sentence prominently before TTS speaks it
  - [ ] "Speak" button (manual trigger) + visual countdown for auto-trigger
  - [ ] Only speak the final formed sentence (not individual signs)

### LLM Setup (One-Time)

- [ ] Install [Ollama](https://ollama.ai) on the laptop
- [ ] Pull model: `ollama pull gemma2:2b` (~1.6GB download)
- [ ] Verify: `ollama run gemma2:2b "Form a sentence from: help, water"`

**Gate:** Signs accumulate → sentence formed via local LLM → spoken aloud. Fallback works when Ollama is offline.

---

## Phase 4: Stylize

**Goal:** Make the phone UI clear, high-contrast, and functional — NOT flashy.

- [ ] `phone/style.css` — design system
  - [ ] Dark background, white/bright text — high contrast
  - [ ] Large font sizes (minimum 20px body, 32px+ for recognition labels)
  - [ ] Minimal animation — no glassmorphism, no heavy motion
  - [ ] Confidence indicator (bar or percentage, visually prominent)
  - [ ] "Did you mean?" fallback UI for low-confidence results
  - [ ] Live landmark overlay with clear hand outlines
  - [ ] Caption area for ASR transcription
  - [ ] Mobile-first layout, full-screen

- [ ] Responsive testing on actual phone screen

**Gate:** UI is readable at arm's length. Captions are legible. Confidence is visible. No decorative noise.

---

## Phase 5: Trigger (Local Deployment)

**Goal:** Full working round trip, documented and repeatable.

- [ ] Complete round trip test: sign → capture → send → recognize → speak → display
- [ ] Test with at least 3 different signs from the vocabulary
- [ ] Test DTW path independently
- [ ] Test AI4Bharat path (if model loaded successfully)
- [ ] Test low-confidence scenario ("Did you mean?" UI)
- [ ] Test ASR caption display
- [ ] Test network failure recovery (server down, timeout)
- [ ] Document final setup process in GEMINI.md §4 (maintenance section)
- [ ] Update `progress.md` with all test results
- [ ] Record any known issues or limitations

**Gate:** A non-developer team member can follow the setup instructions in GEMINI.md and get a working demo in under 10 minutes.

---

## Parking Lot (Out of Scope for This Prototype)

- [ ] Native Android app (future — use `createOnDeviceSpeechRecognizer()`)
- [ ] Full 263-sign vocabulary expansion
- [ ] Continuous/fluent sign recognition
- [ ] Speech-to-sign avatar or video generation
- [ ] Cloud deployment
- [ ] INCLUDE model fine-tuning on hand-only landmarks
- [ ] Multi-language sentence formation (Hindi, Telugu, etc.)
- [ ] Conversation memory across sentence formation calls

---

*Last updated: 2026-09-11*
