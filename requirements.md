# Requirements

These are the public HTTP endpoints VoiceTree runs, checked by the Assure workflow (`.github/workflows/assure.yml`).

- https://voicetree.io/ serves the VoiceTree website over HTTPS and tells browsers to use HTTPS only (Strict-Transport-Security).
- https://www.voicetree.io/ permanently redirects to https://voicetree.io/.
- The share worker at https://share-worker.manummasson8.workers.dev accepts uploads only through POST /upload; any other request to /upload returns no shared content.
- None of these endpoints sets a cookie.
