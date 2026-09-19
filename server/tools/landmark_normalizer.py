"""
Landmark Normalizer
───────────────────
Normalize any-length hand landmark sequence to exactly 45 frames.
- Longer sequences: uniform temporal sampling (pick evenly spaced frames)
- Shorter sequences: repeat last frame to pad up to 45
- Exactly 45: pass through unchanged

Each frame is a list of hand entries. Each hand entry has:
  {"hand": "right"|"left", "points": [[x,y,z], ...]}  (21 points)

This module operates on the 'landmarks' array from GEMINI.md §1.1.
"""

import math
from typing import List, Dict, Any

TARGET_FRAMES = 45


def normalize_landmarks(landmarks: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Normalize a landmark sequence to exactly TARGET_FRAMES frames.

    Args:
        landmarks: List of landmark entries, each with 'frame', 'hand', 'points'.
                   Ordered by ascending frame number.

    Returns:
        New list of landmark entries normalized to TARGET_FRAMES frames,
        with frame numbers re-indexed 0 through TARGET_FRAMES-1.
    """
    if not landmarks:
        return landmarks

    # Group entries by frame number
    frames_dict: Dict[int, List[Dict[str, Any]]] = {}
    for entry in landmarks:
        frame_num = entry['frame']
        if frame_num not in frames_dict:
            frames_dict[frame_num] = []
        frames_dict[frame_num].append(entry)

    # Sort frame numbers
    frame_numbers = sorted(frames_dict.keys())
    num_frames = len(frame_numbers)

    if num_frames == 0:
        return landmarks

    # Select which source frames to keep
    if num_frames == TARGET_FRAMES:
        # Pass through unchanged
        selected_indices = list(range(num_frames))
    elif num_frames > TARGET_FRAMES:
        # Downsample: pick evenly spaced frames
        selected_indices = [
            round(i * (num_frames - 1) / (TARGET_FRAMES - 1))
            for i in range(TARGET_FRAMES)
        ]
    else:
        # Pad: use all frames, then repeat last frame
        selected_indices = list(range(num_frames))
        last_idx = num_frames - 1
        selected_indices.extend([last_idx] * (TARGET_FRAMES - num_frames))

    # Build normalized output
    normalized = []
    for new_frame_num, src_idx in enumerate(selected_indices):
        src_frame_num = frame_numbers[src_idx]
        for entry in frames_dict[src_frame_num]:
            normalized.append({
                'frame': new_frame_num,
                'hand': entry['hand'],
                'points': entry['points']  # reference, not deep copy — caller should not mutate
            })

    return normalized


def get_frame_count(landmarks: List[Dict[str, Any]]) -> int:
    """Count the number of unique frames in a landmark sequence."""
    if not landmarks:
        return 0
    return len(set(entry['frame'] for entry in landmarks))
