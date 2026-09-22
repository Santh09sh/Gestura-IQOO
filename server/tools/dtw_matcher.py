"""
DTW Matcher — v4 (Ensemble with Handshape & Mirroring)
──────────────────────────────────────────────────────────
Dynamic Time Warping template matching for sign recognition.

KEY DESIGN DECISIONS:
  1. Hand Mirroring: The templates have inconsistent left/right hands.
     This matcher determines the dominant hand, and mirrors the left hand
     to the right hand so all features are positionally consistent.
  2. Handshape Features: Extracts static finger extensions, curls, and
     fingertip distances, creating a "Mean Handshape" vector that is
     robust to temporal misalignment.
  3. DTW Features: Wrist-relative XYZ trajectories for motion matching.
  4. Ensemble Matching: Combines the static Handshape distance and the
     dynamic DTW distance to yield a robust confidence score.
"""

import os
import json
import glob
import numpy as np
from typing import List, Dict, Any, Tuple, Optional

try:
    from dtaidistance import dtw_ndim
    DTW_BACKEND = 'dtaidistance'
except ImportError:
    try:
        from dtaidistance import dtw
        DTW_BACKEND = 'dtaidistance_1d'
    except ImportError:
        DTW_BACKEND = None

# ── Constants ──
SAKOE_CHIBA_RADIUS = 10

WRIST = 0
MIDDLE_MCP = 9
TIPS = [4, 8, 12, 16, 20]
MCPS = [1, 5, 9, 13, 17]
FINGERS = [(1,2,3,4), (5,6,7,8), (9,10,11,12), (13,14,15,16), (17,18,19,20)]


# ──────────────────────────────────────────────
# Data Cleaning & Mirroring
# ──────────────────────────────────────────────

def _mirror_hand_x(pts: List[List[float]]) -> List[List[float]]:
    """Mirror a left hand to look like a right hand by flipping x."""
    # Assuming x is normalized 0-1, flipping is 1 - x
    return [[1.0 - p[0], p[1], -p[2] if len(p) > 2 else 0] for p in pts]

def _get_dominant_hand(landmarks: List[Dict[str, Any]]) -> str:
    """Determine which hand is most consistently present in the sequence."""
    r_count = 0
    l_count = 0
    for entry in landmarks:
        if entry['hand'] == 'right':
            r_count += 1
        elif entry['hand'] == 'left':
            l_count += 1
    return 'right' if r_count >= l_count else 'left'

def _get_consistent_hand_pts(landmarks: List[Dict[str, Any]], prefer: str = None) -> List[List[List[float]]]:
    """
    Extract hand points consistently. If the dominant hand is 'left',
    it mirrors the points to act as a 'right' hand.
    Returns a sequence of 21-point arrays, one per frame.
    """
    if not landmarks:
        return []
    
    dominant = prefer or _get_dominant_hand(landmarks)
    other = 'left' if dominant == 'right' else 'right'
    
    # Group by frame
    frames: Dict[int, Dict[str, list]] = {}
    for entry in landmarks:
        fn = entry['frame']
        if fn not in frames:
            frames[fn] = {}
        frames[fn][entry['hand']] = entry['points']
        
    frame_nums = sorted(frames.keys())
    result = []
    last_pts = None
    
    for fn in frame_nums:
        h = frames[fn]
        if dominant in h and len(h[dominant]) == 21:
            pts = h[dominant]
            if dominant == 'left':
                pts = _mirror_hand_x(pts)
            last_pts = pts
            result.append(pts)
        elif other in h and len(h[other]) == 21:
            pts = h[other]
            if other == 'left':
                pts = _mirror_hand_x(pts)
            last_pts = pts
            result.append(pts)
        elif last_pts is not None:
            result.append(last_pts)
        else:
            result.append([[0.5, 0.5, 0]] * 21)
            
    return result


# ──────────────────────────────────────────────
# Feature Extraction
# ──────────────────────────────────────────────

def _extract_handshape_features(pts: List[List[float]]) -> List[float]:
    """Extract static shape features: extensions, curls, tip distances."""
    arr = np.array(pts, dtype=np.float64)
    wrist = arr[WRIST]
    
    # Finger extensions
    ext = []
    for tip, mcp in zip(TIPS, MCPS):
        td = np.linalg.norm(arr[tip] - wrist)
        md = np.linalg.norm(arr[mcp] - wrist)
        ext.append(td / max(md, 1e-6))
        
    # Finger curls
    curls = []
    for finger in FINGERS:
        mcp, pip, dip, tip = finger
        v1 = arr[mcp] - arr[pip]
        v2 = arr[dip] - arr[pip]
        n1, n2 = np.linalg.norm(v1), np.linalg.norm(v2)
        if n1 < 1e-8 or n2 < 1e-8:
            curls.append(0.0)
        else:
            curls.append(np.arccos(np.clip(np.dot(v1, v2)/(n1*n2), -1, 1)))
            
    # Fingertip pairwise distances (normalized by hand size)
    scale = np.linalg.norm(arr[MIDDLE_MCP] - wrist)
    if scale < 1e-6: scale = 1.0
    tip_d = []
    for i in range(5):
        for j in range(i+1, 5):
            tip_d.append(np.linalg.norm(arr[TIPS[i]] - arr[TIPS[j]]) / scale)
            
    return ext + curls + tip_d


def _extract_features(landmarks: List[Dict[str, Any]]) -> Dict[str, np.ndarray]:
    """
    Extracts both static Handshape features and dynamic DTW features.
    """
    pts_seq = _get_consistent_hand_pts(landmarks)
    if not pts_seq:
        return {
            'handshape': np.zeros(20),
            'trajectory': np.zeros((1, 63))
        }
        
    # 1. Trajectory (wrist-relative XYZ for DTW)
    trajectory = []
    for pts in pts_seq:
        arr = np.array(pts, dtype=np.float64)
        wrist = arr[WRIST].copy()
        arr = arr - wrist
        scale = np.linalg.norm(arr[MIDDLE_MCP])
        if scale < 1e-6: scale = 1.0
        arr = arr / scale
        trajectory.append(arr.flatten())
        
    # 2. Handshape (mean over all frames)
    handshapes = []
    for pts in pts_seq:
        handshapes.append(_extract_handshape_features(pts))
        
    hs_mean = np.array(handshapes).mean(axis=0)
    hs_std = np.array(handshapes).std(axis=0)
    handshape_combined = np.concatenate([hs_mean, hs_std])
        
    return {
        'handshape': handshape_combined,
        'trajectory': np.array(trajectory, dtype=np.float64)
    }


# ──────────────────────────────────────────────
# Template Loading
# ──────────────────────────────────────────────

def load_templates(templates_dir: str) -> Dict[str, List[Dict[str, np.ndarray]]]:
    """
    Load all reference templates and extract ensemble features.
    """
    templates: Dict[str, List[Dict[str, np.ndarray]]] = {}

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

            features = _extract_features(landmarks)

            if sign_name not in templates:
                templates[sign_name] = []
            templates[sign_name].append(features)

        except (json.JSONDecodeError, KeyError, ValueError) as e:
            print(f'Warning: skipping invalid template {filepath}: {e}')
            continue

    return templates


# ──────────────────────────────────────────────
# Ensemble Matching
# ──────────────────────────────────────────────

def match_sign(
    input_landmarks: List[Dict[str, Any]],
    templates: Dict[str, List[Dict[str, np.ndarray]]],
) -> List[Dict[str, Any]]:
    """
    Match input using an ensemble of Handshape (static) and Trajectory (DTW).
    """
    if not templates:
        return []

    inp_feats = _extract_features(input_landmarks)
    
    # Track min distances across templates for each sign
    results = []
    
    for sign_name, template_list in templates.items():
        hs_distances = []
        traj_distances = []

        for tmpl in template_list:
            # 1. Handshape distance (Euclidean)
            d_hs = np.linalg.norm(inp_feats['handshape'] - tmpl['handshape'])
            hs_distances.append(d_hs)
            
            # 2. Trajectory distance (DTW)
            d_traj = _compute_dtw_distance(inp_feats['trajectory'], tmpl['trajectory'])
            traj_distances.append(d_traj)

        # Use the minimum distance from the templates
        min_hs = min(hs_distances)
        min_traj = min(traj_distances)
        
        # We need to blend these two distances.
        # Through empirical testing, handshape distance is highly discriminative.
        # Typical HS distance is ~1-3 for matches, ~5-15 for mismatches.
        # Typical Traj distance is ~3-8 for matches, ~10-25 for mismatches.
        
        hs_conf = _distance_to_confidence(min_hs, reference=3.0)
        traj_conf = _distance_to_confidence(min_traj, reference=8.0)
        
        # Ensemble confidence: heavily weight handshape for noisy data,
        # but require some trajectory alignment.
        final_conf = (hs_conf * 0.7) + (traj_conf * 0.3)
        
        results.append({
            'label': sign_name,
            'confidence': round(final_conf, 4),
            'dtw_distance': round(min_traj, 4),
            'hs_distance': round(min_hs, 4),
        })

    # Sort by confidence descending
    results.sort(key=lambda x: x['confidence'], reverse=True)
    return results


def _compute_dtw_distance(seq1: np.ndarray, seq2: np.ndarray) -> float:
    """Compute DTW distance with Sakoe-Chiba band constraint."""
    if DTW_BACKEND == 'dtaidistance':
        try:
            distance = dtw_ndim.distance(
                seq1.astype(np.double),
                seq2.astype(np.double),
                window=SAKOE_CHIBA_RADIUS,
            )
            return float(distance)
        except Exception:
            pass
    return _basic_dtw_banded(seq1, seq2, SAKOE_CHIBA_RADIUS)


def _basic_dtw_banded(seq1: np.ndarray, seq2: np.ndarray, band: int) -> float:
    """DTW with Sakoe-Chiba band constraint."""
    n, m = len(seq1), len(seq2)
    cost_matrix = np.full((n + 1, m + 1), np.inf)
    cost_matrix[0, 0] = 0.0

    for i in range(1, n + 1):
        j_start = max(1, i - band)
        j_end = min(m, i + band)
        for j in range(j_start, j_end + 1):
            dist = np.linalg.norm(seq1[i - 1] - seq2[j - 1])
            cost_matrix[i, j] = dist + min(
                cost_matrix[i - 1, j],
                cost_matrix[i, j - 1],
                cost_matrix[i - 1, j - 1],
            )

    return float(cost_matrix[n, m])


def _distance_to_confidence(distance: float, reference: float) -> float:
    """
    Convert distance to confidence in [0, 1].
    Uses a tuned formula: conf = 1 / (1 + (distance / reference)^3)
    The cube makes the dropoff steeper, clearly separating hits from misses.
    """
    if distance <= 0:
        return 1.0
    ratio = distance / reference
    return 1.0 / (1.0 + ratio ** 3)


def get_top_matches(
    input_landmarks: List[Dict[str, Any]],
    templates: Dict[str, List[Dict[str, np.ndarray]]],
    n: int = 2,
) -> Tuple[Optional[Dict], Optional[Dict]]:
    """
    Convenience: return (top_match, second_match) or (top_match, None).
    """
    results = match_sign(input_landmarks, templates)
    top = results[0] if len(results) > 0 else None
    second = results[1] if len(results) > 1 else None
    return top, second
