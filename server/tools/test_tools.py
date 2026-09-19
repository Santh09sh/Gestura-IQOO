"""
Test harness for Gestura server tools.
Run with: python -m pytest tools/test_tools.py -v
"""

import json
import os
import tempfile
import numpy as np
import pytest

from tools.landmark_normalizer import normalize_landmarks, get_frame_count, TARGET_FRAMES
from tools.dtw_matcher import (
    load_templates,
    match_sign,
    get_top_matches,
    _landmarks_to_vectors,
    _distance_to_confidence,
)


# ══════════════════════════════════════════════
# Fixtures
# ══════════════════════════════════════════════

def _make_landmark_entry(frame: int, hand: str = 'right', seed: float = 0.0):
    """Create a single landmark entry with deterministic points."""
    np.random.seed(int(seed * 1000) + frame)
    points = np.random.rand(21, 3).tolist()
    return {'frame': frame, 'hand': hand, 'points': points}


def _make_sequence(num_frames: int, hand: str = 'right', seed: float = 0.0):
    """Create a landmark sequence with the given number of frames."""
    return [_make_landmark_entry(f, hand, seed) for f in range(num_frames)]


def _make_two_hand_sequence(num_frames: int, seed: float = 0.0):
    """Create a two-handed landmark sequence."""
    seq = []
    for f in range(num_frames):
        seq.append(_make_landmark_entry(f, 'right', seed))
        seq.append(_make_landmark_entry(f, 'left', seed + 0.5))
    return seq


# ══════════════════════════════════════════════
# Landmark Normalizer Tests
# ══════════════════════════════════════════════

class TestLandmarkNormalizer:

    def test_passthrough_45_frames(self):
        """45-frame sequence should pass through unchanged."""
        seq = _make_sequence(45)
        result = normalize_landmarks(seq)
        assert get_frame_count(result) == TARGET_FRAMES
        # Frame numbers should be 0-44
        frames = sorted(set(e['frame'] for e in result))
        assert frames == list(range(45))

    def test_downsample_90_to_45(self):
        """90-frame sequence should be downsampled to 45."""
        seq = _make_sequence(90)
        result = normalize_landmarks(seq)
        assert get_frame_count(result) == TARGET_FRAMES

    def test_downsample_200_to_45(self):
        """200-frame sequence should be downsampled to 45."""
        seq = _make_sequence(200)
        result = normalize_landmarks(seq)
        assert get_frame_count(result) == TARGET_FRAMES

    def test_pad_20_to_45(self):
        """20-frame sequence should be padded to 45."""
        seq = _make_sequence(20)
        result = normalize_landmarks(seq)
        assert get_frame_count(result) == TARGET_FRAMES

    def test_pad_1_to_45(self):
        """Single-frame sequence should be padded to 45."""
        seq = _make_sequence(1)
        result = normalize_landmarks(seq)
        assert get_frame_count(result) == TARGET_FRAMES
        # All frames should have the same points (padded from frame 0)
        points_set = set()
        for entry in result:
            points_set.add(tuple(tuple(p) for p in entry['points']))
        assert len(points_set) == 1  # All identical

    def test_empty_sequence(self):
        """Empty sequence should return empty."""
        result = normalize_landmarks([])
        assert result == []

    def test_two_hands_preserved(self):
        """Two-handed sequences should preserve both hands per frame."""
        seq = _make_two_hand_sequence(45)
        result = normalize_landmarks(seq)
        assert get_frame_count(result) == TARGET_FRAMES
        # Each frame should have 2 entries (right + left)
        frame_0_entries = [e for e in result if e['frame'] == 0]
        hands = {e['hand'] for e in frame_0_entries}
        assert hands == {'right', 'left'}

    def test_frame_numbers_sequential(self):
        """Output frame numbers should be sequential 0 through 44."""
        seq = _make_sequence(30)
        result = normalize_landmarks(seq)
        frames = sorted(set(e['frame'] for e in result))
        assert frames == list(range(45))


# ══════════════════════════════════════════════
# DTW Matcher Tests
# ══════════════════════════════════════════════

class TestDTWMatcher:

    def _create_temp_templates(self, templates_data):
        """Create temporary template JSON files and return the directory path."""
        tmpdir = tempfile.mkdtemp()
        for i, (sign_name, landmarks) in enumerate(templates_data):
            filepath = os.path.join(tmpdir, f'{sign_name}_{i:02d}.json')
            with open(filepath, 'w') as f:
                json.dump({'sign': sign_name, 'landmarks': landmarks}, f)
        return tmpdir

    def test_load_empty_directory(self):
        """Loading from empty directory returns empty dict."""
        tmpdir = tempfile.mkdtemp()
        templates = load_templates(tmpdir)
        assert templates == {}

    def test_load_nonexistent_directory(self):
        """Loading from nonexistent directory returns empty dict."""
        templates = load_templates('/nonexistent/path')
        assert templates == {}

    def test_load_valid_templates(self):
        """Valid template files should load correctly."""
        seq = _make_sequence(45, seed=1.0)
        tmpdir = self._create_temp_templates([('hello', seq), ('stop', seq)])
        templates = load_templates(tmpdir)
        assert 'hello' in templates
        assert 'stop' in templates
        assert len(templates['hello']) == 1
        assert len(templates['stop']) == 1

    def test_identical_match_highest_confidence(self):
        """Matching a sequence against itself should give highest confidence."""
        seq = _make_sequence(45, seed=1.0)
        tmpdir = self._create_temp_templates([
            ('hello', seq),
            ('stop', _make_sequence(45, seed=2.0)),
        ])
        templates = load_templates(tmpdir)
        results = match_sign(seq, templates)

        assert len(results) >= 2
        assert results[0]['label'] == 'hello'
        assert results[0]['confidence'] > results[1]['confidence']
        # Self-match should have very high confidence (near 1.0)
        assert results[0]['confidence'] > 0.9

    def test_confidence_separation(self):
        """
        CRITICAL CHECK: Correct matches must score noticeably higher
        than wrong matches. If they cluster together, the confidence
        formula or DTW approach needs adjustment.

        This test creates two very different signs and verifies the
        gap between correct and incorrect match confidence.
        """
        # Sign A: all points near (0.1, 0.1, 0.1)
        sign_a = []
        for f in range(45):
            sign_a.append({
                'frame': f,
                'hand': 'right',
                'points': [[0.1 + f * 0.001, 0.1, 0.1]] * 21,
            })

        # Sign B: all points near (0.9, 0.9, 0.9) — maximally different
        sign_b = []
        for f in range(45):
            sign_b.append({
                'frame': f,
                'hand': 'right',
                'points': [[0.9 - f * 0.001, 0.9, 0.9]] * 21,
            })

        tmpdir = self._create_temp_templates([('sign_a', sign_a), ('sign_b', sign_b)])
        templates = load_templates(tmpdir)

        # Match sign_a against templates
        results = match_sign(sign_a, templates)
        top = results[0]
        second = results[1]

        assert top['label'] == 'sign_a', f'Expected sign_a as top match, got {top["label"]}'
        assert top['confidence'] > second['confidence'], 'Top match should have higher confidence'

        # The gap should be meaningful — at least 0.1 apart
        gap = top['confidence'] - second['confidence']
        assert gap > 0.1, (
            f'Confidence gap too small: {gap:.4f}. '
            f'Top: {top["confidence"]:.4f} ({top["label"]}), '
            f'Second: {second["confidence"]:.4f} ({second["label"]}). '
            f'The confidence formula may need adjustment.'
        )

    def test_get_top_matches(self):
        """get_top_matches returns (best, second) tuple."""
        seq = _make_sequence(45, seed=1.0)
        tmpdir = self._create_temp_templates([
            ('hello', seq),
            ('stop', _make_sequence(45, seed=2.0)),
        ])
        templates = load_templates(tmpdir)
        top, second = get_top_matches(seq, templates)

        assert top is not None
        assert top['label'] == 'hello'
        assert second is not None
        assert second['label'] == 'stop'

    def test_no_templates(self):
        """Matching against empty templates returns empty list."""
        seq = _make_sequence(45)
        results = match_sign(seq, {})
        assert results == []


class TestLandmarkVectors:

    def test_single_hand_vector_shape(self):
        """Single-hand landmarks should produce 126-dim vectors (zero-padded left hand)."""
        seq = _make_sequence(5)
        vectors = _landmarks_to_vectors(seq)
        assert vectors.shape == (5, 126)

    def test_two_hand_vector_shape(self):
        """Two-hand landmarks should produce 126-dim vectors."""
        seq = _make_two_hand_sequence(5)
        vectors = _landmarks_to_vectors(seq)
        assert vectors.shape == (5, 126)


class TestConfidence:

    def test_zero_distance(self):
        """Zero distance should give confidence 1.0."""
        assert _distance_to_confidence(0.0, 45) == 1.0

    def test_high_distance_low_confidence(self):
        """High distance should give low confidence."""
        conf = _distance_to_confidence(1000.0, 45)
        assert conf < 0.1

    def test_confidence_range(self):
        """Confidence should always be in [0, 1]."""
        for dist in [0, 0.1, 1, 10, 100, 1000]:
            conf = _distance_to_confidence(dist, 45)
            assert 0 <= conf <= 1


# ══════════════════════════════════════════════
# Run
# ══════════════════════════════════════════════

if __name__ == '__main__':
    pytest.main([__file__, '-v'])
