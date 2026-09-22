# Gestura — Indian Sign Language Recognition

> **⚠️ This is a prototype / proof-of-concept**, built for the iQOO hackathon. It is not production-ready software.

Gestura bridges the communication gap between deaf/hard-of-hearing individuals and hearing people by recognizing Indian Sign Language (ISL) gestures in real time and converting them to spoken words.

## How It Works

1. **Phone captures hand gestures** via the camera using MediaPipe Hand Landmarker (runs entirely in-browser)
2. **Landmarks are sent** to a Python backend over local WiFi
3. **DTW (Dynamic Time Warping)** matches the gesture against recorded reference templates
4. **Result is spoken aloud** on the phone via on-device Text-to-Speech

```
Phone (Camera) → Hand Landmarks → Server (DTW Matching) → Spoken Word
```

## Architecture

```
┌──────────────────────────────────────┐
│  Phone (Mobile Browser)              │
│  • MediaPipe hand tracking           │
│  • Landmark capture & streaming      │
│  • TTS / ASR (on-device)             │
└──────────────┬───────────────────────┘
               │ HTTP (local WiFi)
┌──────────────▼───────────────────────┐
│  Express Proxy (port 3000)           │
│  • Serves phone UI                   │
│  • Proxies /api/* → Flask backend    │
└──────────────┬───────────────────────┘
               │
┌──────────────▼───────────────────────┐
│  Flask Backend (port 5000)           │
│  • /ping — health check             │
│  • /recognize — DTW sign matching    │
│  • 45-frame normalization            │
└──────────────────────────────────────┘
```

## Supported Signs

The current vocabulary includes: **food, good, help, no, please, sorry, yes** (expandable via recorded templates).

## Tech Stack

| Component       | Technology                          |
|-----------------|-------------------------------------|
| Phone UI        | HTML / CSS / JavaScript             |
| Hand Tracking   | MediaPipe Hand Landmarker (in-browser) |
| Server          | Python (Flask)                      |
| Sign Matching   | DTW (Dynamic Time Warping)          |
| TTS             | Web Speech API (on-device)          |
| ASR             | Web Speech API (on-device)          |
| Connectivity    | HTTP over local WiFi / Cloudflare Tunnel |

## Quick Start

### Prerequisites

- Python 3.9+
- Node.js 18+
- Phone and laptop on the same WiFi network

### Setup

```bash
# 1. Install Python dependencies
cd server
pip install -r requirements.txt

# 2. Install Node dependencies (from project root)
cd ..
npm install

# 3. Start everything (Windows)
start-gestura.bat
```

This starts:
- Flask backend on `localhost:5000`
- Express proxy on `localhost:3000`
- Cloudflare tunnel (provides a public HTTPS URL)

Open the tunnel URL on your phone to start recognizing signs.

## Project Structure

```
gestura-prototype/
├── server/
│   ├── app.py                  # Flask API server
│   └── tools/
│       ├── landmark_normalizer.py  # 45-frame normalization
│       └── dtw_matcher.py          # DTW template matching
├── phone/
│   ├── index.html              # Mobile web app
│   ├── style.css               # UI styles
│   └── js/
│       ├── main.js             # App controller
│       ├── hand_tracker.js     # MediaPipe wrapper
│       ├── capture.js          # Landmark capture
│       ├── network.js          # Server communication
│       ├── tts.js              # Text-to-speech
│       └── asr.js              # Speech recognition
├── dtw_references/             # Recorded sign templates
├── proxy.js                    # Express reverse proxy
└── start-gestura.bat           # One-click launcher (Windows)
```

## Key Design Decisions

- **Zero cloud dependency** — all recognition runs locally, no API calls
- **Isolated sign capture** — one sign at a time (tap-to-capture), not continuous signing
- **DTW-first approach** — no model training needed, just record reference templates
- **45-frame normalization** — all gesture sequences are normalized to 45 frames before matching

## Prototype Limitations

- Limited vocabulary (7 signs currently)
- Requires both devices on the same network
- Single-hand recognition only for most signs
- Not optimized for production performance
- AI4Bharat transformer integration is planned but not yet complete

## License

MIT

---

*Built at the iQOO hackathon, 2026*
