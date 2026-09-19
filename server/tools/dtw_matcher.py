"""
DTW Matcher
───────────
Dynamic Time Warping template matching for sign recognition.
Loads reference templates from dtw_references/, computes DTW distance
between input and all templates, returns top-2 matches with confidence.

Confidence formula: 1 / (1 + normalized_dtw_distance)
Important: validate this formula against real data early — confirm
correct matches score noticeably higher than wrong matches.

Each reference template is a JSON file:
  {
    "sign": "hello",
    "landmarks": [ ... ]   // 45-frame normalized sequence
  }

Per-frame distance: Euclidean distance between flattened landmark arrays.
DTW aligns two 45-length sequences of these vectors.
"""

import os
import json
import glob
import numpy as np
from typing import List, Dict, Any, Tuple, Optional

try:
    from dtaidistance import dtw
    DTW_BACKEND = 'dtaidistance'
except ImportError:
    DTW_BACKEND = None


# ──────────────────────────────────────────────
# Template Loading
# ──────────────────────────────────────────────

def load_templates(templates_dir: str) -> Dict[str, List[np.ndarray]]:
    """
    Load all reference templates from the given directory.

    Returns:
        Dict mapping sign name → list of template sequences.
        Each sequence is a list of numpy arrays (one per frame).
        Multiple templates per sign are supported (e.g., hello_01.json, hello_02.json).
    """
    templates: Dict[str, List[np.ndarray]] = {}

    if not os.path.isdir(templates_dir):
        return templates

    for filepath in glob.glob(os.path.join(templates_dir, '*.json')):
        try:
            with open(filepath, 'r') as f:
                data = json.load(f)

            sign_name = data.get('sign', '')
            landmarks = data.get('landmarks', [])

            if not sign_name or not landmarks:
                continue

            # Convert landmarks to frame vectors
            frame_vectors = _landmarks_to_vectors(landmarks)

            if sign_name not in templates:
                templates[sign_name] = []
            templates[sign_name].append(frame_vectors)

        except (json.JSONDecodeError, KeyError, ValueError) as e:
            print(f'Warning: skipping invalid template {filepath}: {e}')
            continue

    return templates


def _landmarks_to_vectors(landmarks: List[Dict[str, Any]]) -> np.ndarray:
    """
    Convert landmark entries to a 2D numpy array of shape (num_frames, feature_dim).

    Groups by frame, flattens all hand points per frame into a single vector.
    For one hand: 21 points × 3 coords = 63 dims.
    For two hands: 42 points × 3 coords = 126 dims.

    To handle variable hand count, we always produce 126-dim vectors,
    zero-padding if only one hand is present.
    """
    # Group by frame
    frames_dict: Dict[int, Dict[str, List]] = {}
    for entry in landmarks:
        frame_num = entry['frame']
        if frame_num not in frames_dict:
            frames_dict[frame_num] = {}
        frames_dict[frame_num][entry['hand']] = entry['points']

    frame_numbers = sorted(frames_dict.keys())
    vectors = []

    for fn in frame_numbers:
        hands = frames_dict[fn]
        # Always: right hand first (63 dims), then left hand (63 dims)
        right_pts = hands.get('right', [[0, 0, 0]] * 21)
        left_pts = hands.get('left', [[0, 0, 0]] * 21)

        # Flatten: 21 points × 3 coords = 63 per hand, 126 total
        right_flat = [coord for pt in right_pts for coord in pt]
        left_flat = [coord for pt in left_pts for coord in pt]

        vectors.append(right_flat + left_flat)

    return np.array(vectors, dtype=np.float64)


# ──────────────────────────────────────────────
# DTW Matching
# ──────────────────────────────────────────────

def match_sign(
    input_landmarks: List[Dict[str, Any]],
    templates: Dict[str, List[np.ndarray]],
) -> List[Dict[str, Any]]:
    """
    Match input landmarks against all templates using DTW.

    Args:
        input_landmarks: Normalized (45-frame) landmark sequence.
        templates: Dict from load_templates().

    Returns:
        List of matches sorted by confidence (descending), each:
        {
            "label": str,
            "confidence": float,
            "dtw_distance": float
        }
        Returns at least top-2 if enough templates exist.
    """
    if not templates:
        return []

    input_vectors = _landmarks_to_vectors(input_landmarks)

    results = []
    for sign_name, template_list in templates.items():
        # Use minimum distance across all templates for this sign
        min_distance = float('inf')
        for template_vectors in template_list:
            dist = _compute_dtw_distance(input_vectors, template_vectors)
            if dist < min_distance:
                min_distance = dist

        confidence = _distance_to_confidence(min_distance, input_vectors.shape[0])
        results.append({
            'label': sign_name,
            'confidence': round(confidence, 4),
            'dtw_distance': round(min_distance, 4),
        })

    # Sort by confidence descending
    results.sort(key=lambda x: x['confidence'], reverse=True)
    return results


def _compute_dtw_distance(seq1: np.ndarray, seq2: np.ndarray) -> float:
    """
    Compute DTW distance between two sequences.

    Each sequence is shape (num_frames, feature_dim).
    Uses dtaidistance if available, otherwise falls back to a basic implementation.
    """
    if DTW_BACKEND == 'dtaidistance':
        # dtaidistance expects 1D series — we compute per-frame Euclidean distances
        # and use the multi-dimensional DTW support
        try:
            # Use the subsequence-aware DTW on flattened per-frame distances
            # dtaidistance supports ndim via dtw_ndim
            from dtaidistance import dtw_ndim
            distance = dtw_ndim.distance(seq1, seq2)
            return float(distance)
        except (ImportError, Exception):
            pass

    # Fallback: basic DTW implementation
    return _basic_dtw(seq1, seq2)


def _basic_dtw(seq1: np.ndarray, seq2: np.ndarray) -> float:
    """Basic DTW implementation using numpy. O(n*m) time and space."""
    n, m = len(seq1), len(seq2)
    cost_matrix = np.full((n + 1, m + 1), np.inf)
    cost_matrix[0, 0] = 0.0

    for i in range(1, n + 1):
        for j in range(1, m + 1):
            # Euclidean distance between frame vectors
            dist = np.linalg.norm(seq1[i - 1] - seq2[j - 1])
            cost_matrix[i, j] = dist + min(
                cost_matrix[i - 1, j],      # insertion
                cost_matrix[i, j - 1],      # deletion
                cost_matrix[i - 1, j - 1],  # match
            )

    return float(cost_matrix[n, m])


def _distance_to_confidence(distance: float, num_frames: int) -> float:
    """
    Convert DTW distance to a confidence score in [0, 1].

    Formula: 1 / (1 + normalized_distance)
    where normalized_distance = distance / num_frames

    This normalization makes confidence comparable across different
    sequence lengths (though ours are always 45 after normalization).

    IMPORTANT: validate this formula against real data early.
    Correct matches should score noticeably higher than wrong matches.
    If they cluster together, the formula or the threshold needs adjustment.
    """
    if num_frames == 0:
        return 0.0
    normalized = distance / num_frames
    return 1.0 / (1.0 + normalized)


def get_top_matches(
    input_landmarks: List[Dict[str, Any]],
    templates: Dict[str, List[np.ndarray]],
    n: int = 2,
) -> Tuple[Optional[Dict], Optional[Dict]]:
    """
    Convenience: return (top_match, second_match) or (top_match, None).

    Returns:
        Tuple of (best_match_dict, second_best_dict_or_None)
    """
    results = match_sign(input_landmarks, templates)
    top = results[0] if len(results) > 0 else None
    second = results[1] if len(results) > 1 else None
    return top, second
