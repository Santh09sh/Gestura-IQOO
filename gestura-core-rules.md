# Gestura — Core Rules (Antigravity)

**Where this goes:** save as `.agents/rules/gestura-core.md` in your project root (create the `.agents/rules/` folder if it doesn't exist yet — Antigravity reads it automatically once it's there).

**Setup in the UI (do this once):** "..." menu in the Agent panel → Customizations → Rules → + Workspace → set Activation Mode to **Always On** → paste everything below the line.

---

## Offline is non-negotiable

- Never call a cloud API, hosted model, or remote endpoint for sign recognition, speech recognition, speech synthesis, or translation. This applies even if it would be faster to implement or more accurate. The entire product's value proposition is zero cloud dependency — a single accidental network call breaks the core claim.
- If you're implementing speech recognition on Android, use `SpeechRecognizer.createOnDeviceSpeechRecognizer(Context)` specifically, and check `isOnDeviceRecognitionAvailable()` before relying on it. Do not use the generic `createSpeechRecognizer()` — it may silently route audio to a remote server.
- If a library or approach seems to require internet access to function, flag it and stop rather than working around it quietly.

## Scope discipline

- The sign vocabulary is fixed at 15–20 signs, defined in `findings.md`. Do not add signs, expand scope, or suggest a bigger vocabulary unless explicitly told to.
- Recognize isolated, pause-or-tap-triggered signs only. Do not attempt to build continuous or fluent sentence-level sign recognition — this is out of scope by design, not an oversight.
- Never generate synthetic video, images, or an avatar for the reverse (speech-to-sign) direction. Captions only. This was a deliberate, considered product decision — do not "improve" it by adding generation.

## Recognition pipeline

- Always keep the DTW fallback path working, independent of whether the AI4Bharat model integration is complete. Never let the project be in a state where recognition only works if one specific model export succeeded.
- Normalize every sign's landmark sequence to a fixed frame count (default: 45 frames — sample down if longer, pad if shorter) before it reaches any classifier, in both the AI4Bharat and DTW paths.
- When uncertain which recognition path produced a result, always include `"source": "ai4bharat"` or `"source": "dtw"` in the response payload — this must never be ambiguous, including in logs.

## Design and UI

- Priority is clarity and legibility, not visual polish. This is an accessibility tool — captions and labels need to be readable at a glance under real conditions, not styled for a landing page.
- Default to large text, high contrast, minimal animation. Do not apply glassmorphism, heavy motion design, or dense modern-SaaS styling unless explicitly asked — override any built-in default toward "premium/dynamic" aesthetics for this project specifically.

## Code quality

- Keep functions and scripts small, atomic, and independently testable — this mirrors the Tools-layer principle already in the project blueprint.
- Every change to recognition logic should be checked against the same fixed set of recorded reference signs before being considered done. Don't declare something "working" from a single successful run.
- Before adding any new dependency, confirm it's free and open-source with no usage limits or account requirement. If it isn't, stop and ask rather than installing it.
