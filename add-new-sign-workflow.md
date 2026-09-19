# Workflow: Add a new sign to the vocabulary

**Where this goes:** save as `.agents/workflows/add-new-sign.md` in your project root. Trigger it in Antigravity's agent chat with `/add-new-sign`.

---

Add a new sign to Gestura's recognized vocabulary. Follow these steps in order and do not skip the confirmation step.

1. Confirm the current vocabulary size from `findings.md`. If it's already at 20 signs, stop and flag this to the user rather than adding an 21st automatically.
2. Prompt for the sign's word/phrase and how many reference recordings are available (minimum 3).
3. For each reference recording: extract the landmark sequence using the existing MediaPipe pipeline, normalize to the fixed frame count already defined in the rules, and save it to the DTW reference set with a clear filename (`signname_01.json`, `signname_02.json`, etc.).
4. Add the new sign's label to the vocabulary list in `findings.md`.
5. Run a recognition test: perform the new sign live (or replay a held-out recording not used as a reference) and confirm the DTW matcher correctly identifies it against the full current vocabulary, not just against itself.
6. If using the AI4Bharat path, confirm the new sign exists in its label set (`label_maps/`) — if it doesn't, note this clearly rather than silently falling back to DTW-only for that sign.
7. Log the result in `progress.md`: which sign was added, how many reference clips, and whether the test in step 5 passed.
