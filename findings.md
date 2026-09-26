# Gestura — Findings

> Research discoveries, constraints, and the curated sign vocabulary.

---

## 1. AI4Bharat INCLUDE Model

### What it is
- **Repo:** github.com/AI4Bharat/INCLUDE
- **License:** MIT — free to use, no account required
- **Paper:** "INCLUDE: Isolated Indian Sign Language Recognition"
- **Architecture:** Transformer-based classifier operating on pre-extracted landmarks
- **Input:** Sequences of landmarks extracted via MediaPipe Holistic (553 landmarks total: 478 face + 33 pose + 21 per hand × 2)
- **Output:** Classification across 263 ISL word classes
- **Pretrained weights:** Available via `--use_pretrained` flag in `runner.py`
- **Key files:** `runner.py`, `generate_keypoints.py`, `label_map.json`

### Integration approach for this prototype
- We extract only **hand landmarks** (21 per hand, up to 42 total) using MediaPipe Hand Landmarker in-browser.
- The INCLUDE model was trained on the full 553-landmark set. **Gap identified:** our 42 hand-only landmarks don't match the model's expected 553-dim input.
- **Mitigation options:**
  1. Pad the missing face/pose landmarks with zeros → may work if the model learned to weight hand landmarks heavily (needs testing).
  2. Retrain/fine-tune the model on hand-only landmarks for our 15–20 sign subset → adds complexity but guarantees compatibility.
  3. Use the DTW path as primary until model compatibility is validated → safest for the prototype.
- **Decision:** Start with DTW as the reliable path. Investigate option 1 (zero-padding) in parallel. If it produces reasonable accuracy (>70% on our subset), use it. Otherwise, DTW is the primary classifier for the prototype demo.

### INCLUDE label map (relevant subset)
The full dataset has 263 signs across 15 categories. Relevant categories for our vocabulary:
- Greetings: hello, goodbye, thank you, sorry, please
- Common words: yes, no, help, water, food, eat, drink
- Emergencies: stop, help
- Numbers: could include 1–5

---

## 2. Sign Vocabulary

> **STATUS: AWAITING TEAM CONFIRMATION**
> The vocabulary below is a proposed starting set of 15 signs. The team must confirm or modify this list before reference recordings begin.

### Proposed vocabulary (15 signs)

| # | Sign | Category | Notes |
|---|------|----------|-------|
| 1 | hello | greeting | Common ISL greeting gesture |
| 2 | thank_you | greeting | Two-hand gesture in ISL |
| 3 | sorry | greeting | |
| 4 | please | greeting | |
| 5 | yes | common | Head nod + hand in ISL |
| 6 | no | common | |
| 7 | help | emergency | |
| 8 | stop | emergency | |
| 9 | water | basic needs | |
| 10 | food | basic needs | |
| 11 | eat | basic needs | |
| 12 | good | adjective | |
| 13 | bad | adjective | |
| 14 | my_name | introduction | |
| 15 | how_are_you | greeting | |

**Requirements per sign:**
- Minimum 3 reference recordings for DTW templates
- Must verify existence in INCLUDE's `label_map.json` for the AI4Bharat path
- Each recording → landmark extraction → 45-frame normalization → saved as `dtw_references/{sign_name}_01.json`

---

## 3. MediaPipe Hand Landmarker (Browser)

### Library
- `@mediapipe/tasks-vision` — current, supported API (not the deprecated `@mediapipe/hands`)
- CDN: `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/vision_bundle.mjs`
- Model bundle: `hand_landmarker.task` (~5MB, downloaded once)

### Configuration for this project
- `runningMode: 'LIVE_STREAM'` for real-time camera feed
- `numHands: 2` (some ISL signs use both hands)
- Result listener callback delivers landmarks asynchronously
- Each landmark: `{x, y, z}` normalized; x,y ∈ [0,1], z = depth relative to wrist

### Camera requirements
- `getUserMedia()` requires HTTPS or localhost
- For WiFi serving to phone: need an HTTPS server (self-signed cert via `mkcert` is acceptable)

---

## 4. DTW Fallback Path

### Algorithm
- Dynamic Time Warping on sequences of 21-dimensional landmark vectors (or 42-dim if two hands)
- Library options: `dtaidistance` (fast C backend), `fastdtw` (approximate, faster)
- Each reference sign stored as a JSON file with its normalized 45-frame landmark sequence
- At inference: compute DTW distance between input sequence and all reference templates → pick lowest distance

### Normalization
- Fixed at 45 frames (per GEMINI.md §1.1 rules)
- Temporal sampling: if sequence has N > 45 frames, pick frames at indices `[0, N/45, 2N/45, ..., 44N/45]` (uniform)
- Temporal padding: if sequence has N < 45 frames, repeat last frame to fill

### Distance metric
- Per-frame distance: Euclidean distance between two 21×3 landmark arrays (flattened to 63-dim vector)
- DTW aligns two 45-length sequences of 63-dim vectors
- Confidence derived from inverse distance: `confidence = 1 / (1 + normalized_dtw_distance)`

---

## 5. SPOTER Reference (Not a Dependency)

- SPOTER is a pose-based sign recognition transformer, low-compute oriented
- Trained on ASL (WLASL) and LSA64, **not ISL**
- Validates the general direction (transformer on landmarks works for sign recognition)
- We do not use SPOTER code or weights — it's background validation only

---

## 6. Web Speech APIs

### Text-to-Speech (TTS)
- `window.speechSynthesis.speak(new SpeechSynthesisUtterance(text))`
- Fully on-device in all modern mobile browsers
- Can set language, rate, pitch
- No network call — confirmed offline-capable

### Speech Recognition (ASR)
- `new webkitSpeechRecognition()` / `new SpeechRecognition()`
- **Warning:** Browser implementations may route audio to cloud servers for processing
- On Chrome Android: may use Google's cloud speech API
- **Mitigation for prototype:** Accept this limitation for the web prototype; document it clearly. For the native Android build, mandate `createOnDeviceSpeechRecognizer()`.
- For the prototype demo, if offline ASR is critical, explore Web Speech API with `interimResults` in airplane mode to verify behavior.

---

## 7. Constraints and Known Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| INCLUDE model expects 553 landmarks, we provide 42 | High | DTW is primary path; test zero-padding on INCLUDE model |
| Web Speech Recognition may use cloud | Medium | Accept for web prototype; enforce on-device for native Android |
| HTTPS requirement for camera access over WiFi | Low | Use `mkcert` for self-signed local certificate |
| Phone ↔ laptop network latency | Low | Keep payloads small (landmarks only, no video) |
| MediaPipe model download size (~5MB) | Low | Cache on first load; show loading indicator |

---

## 8. NLU — Sentence Formation via Local LLM

### Problem
Raw sign recognition produces isolated keywords: `HELP`, `WATER`. This is unnatural and difficult for hearing people to understand in conversation. ISL also has a different grammatical structure from English (e.g., SOV order), so direct concatenation doesn't produce readable English.

### Approach: Local LLM via Ollama
- **Ollama** provides a local REST API for running open-weight LLMs
- One-command install: `curl -fsSL https://ollama.ai/install.sh | sh` (or Windows installer)
- Models pulled once: `ollama pull gemma2:2b` (~1.6GB)
- REST endpoint: `POST http://localhost:11434/api/generate`
- **Zero cloud dependency** — everything runs on the laptop

### Model Selection

| Model | Size | Speed (laptop) | Quality | Recommendation |
|-------|------|----------------|---------|----------------|
| Gemma 2B | ~1.6GB | ~2-3s | Good for simple sentences | **Primary choice** |
| Phi-3 Mini (3.8B) | ~2.3GB | ~4-5s | Better grammar | Alternative |
| Llama 3.2 1B | ~1.3GB | ~1-2s | Acceptable | Fastest option |
| Gemma 7B | ~5GB | ~8-10s | Excellent | If laptop has GPU |

**Decision:** Start with `gemma2:2b` — small enough for CPU inference, good sentence quality for our vocabulary.

### Prompt Engineering Strategy

```
System: You are a sign language interpreter. Convert ISL sign keywords into a natural,
polite English sentence. Output ONLY the sentence, nothing else. Keep it concise and
conversational. The signs are in the order they were performed.

User: help, water
Assistant: Could you please give me some water?

User: hello, how_are_you
Assistant: Hello! How are you doing?

User: food, please
Assistant: Could I have some food, please?
```

Key constraints for the prompt:
- Output only the sentence (no explanations, no quotes)
- Keep sentences short and conversational
- Maintain politeness appropriate to ISL communication context
- Handle single-sign inputs (just speak the word naturally)

### Fallback Strategy
If Ollama is not running or the model fails:
1. Join signs with spaces: `"help water"` → `"help water"`
2. Speak the fallback string via TTS
3. Mark response with `"source": "fallback"` so the phone UI can indicate degraded mode

### Latency Budget
- Target: < 3 seconds from buffer-complete to TTS start
- Ollama generation (2B model, ~20 tokens): ~2-3s on CPU
- Network round trip (LAN): < 50ms
- Acceptable for conversational pace

---

*Last updated: 2026-09-26*
