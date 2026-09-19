"""
ASR Handler — Local Speech-to-Text via faster-whisper
─────────────────────────────────────────────────────
Fallback transcription path for when the phone's on-device
SpeechRecognition (processLocally=true) doesn't work.

Phone streams audio to the server's /transcribe endpoint,
this module runs it through faster-whisper locally.

ZERO CLOUD DEPENDENCY: faster-whisper runs entirely on-device
using CTranslate2. No API keys, no network calls.
"""

import os
import tempfile
from typing import Optional, Dict, Any

# Lazy-load faster-whisper to avoid import errors if not installed
_model = None
_model_size = 'base'  # 'tiny', 'base', 'small', 'medium', 'large-v3'


def _get_model():
    """Lazy-initialize the whisper model on first use."""
    global _model
    if _model is None:
        try:
            from faster_whisper import WhisperModel
            _model = WhisperModel(
                _model_size,
                device='cpu',         # No GPU requirement for prototype
                compute_type='int8',  # Fast on CPU
            )
            print(f'[ASR] faster-whisper model "{_model_size}" loaded')
        except ImportError:
            print('[ASR] faster-whisper not installed — transcription unavailable')
            print('[ASR] Install with: pip install faster-whisper')
            raise
        except Exception as e:
            print(f'[ASR] Failed to load model: {e}')
            raise
    return _model


def transcribe_audio(audio_bytes: bytes, sample_rate: int = 16000) -> Dict[str, Any]:
    """
    Transcribe audio bytes to text using faster-whisper.

    Args:
        audio_bytes: Raw audio data (WAV or WebM format)
        sample_rate: Audio sample rate (default 16kHz)

    Returns:
        {
            "text": "transcribed text here",
            "language": "en",
            "segments": [...],  # optional detail
            "error": null
        }
    """
    try:
        model = _get_model()

        # Write audio to temp file (faster-whisper reads from file)
        with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp:
            tmp.write(audio_bytes)
            tmp_path = tmp.name

        try:
            segments, info = model.transcribe(
                tmp_path,
                language='en',       # Force English for now
                beam_size=5,
                best_of=5,
                temperature=0.0,
                vad_filter=True,     # Filter out silence
            )

            # Collect all segment texts
            text_parts = []
            segment_details = []
            for segment in segments:
                text_parts.append(segment.text.strip())
                segment_details.append({
                    'start': round(segment.start, 2),
                    'end': round(segment.end, 2),
                    'text': segment.text.strip(),
                })

            full_text = ' '.join(text_parts)

            return {
                'text': full_text,
                'language': info.language if info else 'en',
                'segments': segment_details,
                'error': None,
            }
        finally:
            # Clean up temp file
            try:
                os.unlink(tmp_path)
            except OSError:
                pass

    except ImportError:
        return {
            'text': '',
            'language': 'en',
            'segments': [],
            'error': 'faster-whisper not installed',
        }
    except Exception as e:
        return {
            'text': '',
            'language': 'en',
            'segments': [],
            'error': str(e),
        }


def is_available() -> bool:
    """Check if the transcription engine is available."""
    try:
        _get_model()
        return True
    except Exception:
        return False
