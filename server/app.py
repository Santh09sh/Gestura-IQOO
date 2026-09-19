# Gestura Server — Navigation Layer
# Thin routing only. Dispatches to tools, doesn't reason.

import os
import json
import datetime
from flask import Flask, request, jsonify
from flask_cors import CORS

from tools.landmark_normalizer import normalize_landmarks, get_frame_count
from tools.dtw_matcher import load_templates, get_top_matches

app = Flask(__name__)
CORS(app)  # Phone page is served from a different origin/port

# ──────────────────────────────────────────────
# Configuration
# ──────────────────────────────────────────────

DTW_TEMPLATES_DIR = os.path.join(os.path.dirname(__file__), '..', 'dtw_references')
CONFIDENCE_THRESHOLD = 0.5   # Below this → show "Did you mean?" on phone

# Load DTW templates at startup
_templates = {}


def _reload_templates():
    """Reload DTW templates from disk. Call after recording new references."""
    global _templates
    abs_path = os.path.abspath(DTW_TEMPLATES_DIR)
    _templates = load_templates(abs_path)
    count = sum(len(v) for v in _templates.values())
    signs = list(_templates.keys())
    print(f'[DTW] Loaded {count} template(s) for {len(signs)} sign(s): {signs}')
    return _templates


# ──────────────────────────────────────────────
# Health Check
# ──────────────────────────────────────────────

@app.route('/ping', methods=['GET'])
def ping():
    """Health check per GEMINI.md §1.3."""
    return jsonify({
        'status': 'ok',
        'server_time': datetime.datetime.now(
            datetime.timezone(datetime.timedelta(hours=5, minutes=30))
        ).isoformat(),
        'model_loaded': False,       # AI4Bharat deferred
        'dtw_ready': len(_templates) > 0,
        'vocabulary_size': 15
    })


# ──────────────────────────────────────────────
# Sign Recognition
# ──────────────────────────────────────────────

@app.route('/recognize', methods=['POST'])
def recognize():
    """
    Recognize a sign from hand landmarks.
    Request/response per GEMINI.md §1.1 and §1.2.
    """
    # ── Parse request ──
    data = request.get_json(silent=True)
    if not data:
        return jsonify({'error': 'Invalid JSON body'}), 400

    sign_id = data.get('sign_id')
    landmarks = data.get('landmarks')

    if not sign_id:
        return jsonify({'error': 'Missing sign_id'}), 400
    if not landmarks or not isinstance(landmarks, list):
        return jsonify({'error': 'Missing or invalid landmarks array'}), 400

    # Validate landmark entries have required fields
    for entry in landmarks:
        if 'frame' not in entry or 'hand' not in entry or 'points' not in entry:
            return jsonify({'error': 'Each landmark entry must have frame, hand, and points'}), 400
        if not isinstance(entry['points'], list) or len(entry['points']) != 21:
            return jsonify({'error': 'Each entry must have exactly 21 points'}), 400

    # ── Normalize to 45 frames ──
    normalized = normalize_landmarks(landmarks)

    # ── Check if DTW templates are available ──
    if not _templates:
        return jsonify({
            'sign_id': sign_id,
            'label': 'unknown',
            'confidence': 0.0,
            'alternate_label': 'unknown',
            'alternate_confidence': 0.0,
            'source': 'dtw',
            'error': 'No DTW reference templates loaded. Record some references first.',
        }), 200

    # ── DTW matching ──
    top, second = get_top_matches(normalized, _templates)

    if top is None:
        return jsonify({
            'sign_id': sign_id,
            'label': 'unknown',
            'confidence': 0.0,
            'alternate_label': 'unknown',
            'alternate_confidence': 0.0,
            'source': 'dtw',
        }), 200

    response = {
        'sign_id': sign_id,
        'label': top['label'],
        'confidence': top['confidence'],
        'alternate_label': second['label'] if second else '',
        'alternate_confidence': second['confidence'] if second else 0.0,
        'source': 'dtw',
    }

    return jsonify(response)


# ──────────────────────────────────────────────
# Audio Transcription (ASR fallback)
# ──────────────────────────────────────────────

@app.route('/transcribe', methods=['POST'])
def transcribe():
    """
    Transcribe audio to text using local faster-whisper.
    Fallback for when phone's on-device SpeechRecognition doesn't work.
    """
    if not request.data and not request.files:
        return jsonify({'error': 'No audio data provided'}), 400

    try:
        from tools.asr_handler import transcribe_audio

        # Accept either raw body or file upload
        if request.files and 'audio' in request.files:
            audio_bytes = request.files['audio'].read()
        else:
            audio_bytes = request.data

        result = transcribe_audio(audio_bytes)
        return jsonify(result)

    except ImportError:
        return jsonify({
            'text': '',
            'error': 'faster-whisper not installed on server',
        }), 503
    except Exception as e:
        return jsonify({
            'text': '',
            'error': str(e),
        }), 500


# ──────────────────────────────────────────────
# Template Management (for recording references)
# ──────────────────────────────────────────────

@app.route('/templates/reload', methods=['POST'])
def reload_templates():
    """Reload DTW templates from disk after recording new references."""
    templates = _reload_templates()
    return jsonify({
        'status': 'ok',
        'signs': list(templates.keys()),
        'total_templates': sum(len(v) for v in templates.values()),
    })


@app.route('/templates/save', methods=['POST'])
def save_template():
    """
    Save a new DTW reference template.
    Used by the phone's "Record Reference" mode.
    """
    data = request.get_json(silent=True)
    if not data:
        return jsonify({'error': 'Invalid JSON body'}), 400

    sign_name = data.get('sign')
    landmarks = data.get('landmarks')

    if not sign_name or not landmarks:
        return jsonify({'error': 'Missing sign name or landmarks'}), 400

    # Normalize to 45 frames before saving
    normalized = normalize_landmarks(landmarks)

    # Ensure directory exists
    abs_dir = os.path.abspath(DTW_TEMPLATES_DIR)
    os.makedirs(abs_dir, exist_ok=True)

    # Find next available index for this sign
    existing = [f for f in os.listdir(abs_dir) if f.startswith(sign_name + '_')]
    next_idx = len(existing) + 1
    filename = f'{sign_name}_{next_idx:02d}.json'
    filepath = os.path.join(abs_dir, filename)

    with open(filepath, 'w') as f:
        json.dump({'sign': sign_name, 'landmarks': normalized}, f)

    # Reload templates to include the new one
    _reload_templates()

    return jsonify({
        'status': 'ok',
        'saved': filename,
        'total_for_sign': next_idx,
    })


# ──────────────────────────────────────────────
# Entry point
# ──────────────────────────────────────────────

if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description='Gestura recognition server')
    parser.add_argument('--host', default='0.0.0.0', help='Bind address (default: 0.0.0.0)')
    parser.add_argument('--port', type=int, default=5000, help='Port (default: 5000)')
    args = parser.parse_args()

    # Load templates at startup
    _reload_templates()

    print(f'\nGestura server starting on {args.host}:{args.port}')
    print(f'Phone should connect to http://<your-laptop-ip>:{args.port}/ping')
    print(f'DTW templates directory: {os.path.abspath(DTW_TEMPLATES_DIR)}')
    print()

    app.run(host=args.host, port=args.port, debug=True)
