# Zapper Desktop 1.0.5 — Stable captions and group chat

Built on the complete **v1.0.4** source, not the older desktop project. The API, web and desktop sources are included in this replacement package.

## Changes, limited to two features

1. **Stable overlay text:** Committed caption text now retains the same DOM text node instead of being cleared and redrawn for every interim update. The next interim phrase alone changes. Existing Google Meet caption language/accuracy, PDF transcript capture, scroll position and session handling are retained. This reduces renderer-induced flash; native Meet interim recognition revisions can still occur before finalization.
2. **Real group chat:** The host's own Google Meet window now observes person-authored Meet chat, and the existing PIN-connected desktop chat collector remains active. The authorized API chat relay distributes host/participant messages to connected desktops in the same session (including the host). A second session cannot see them. Exact Meet controls/inactivity/administrative prompts are rejected. No artificial `chat here` message is sent. Zapper no longer truncates outgoing chat at 8,000 characters or discards display history after 60 messages; Google Meet decides what it accepts. Messages are not persisted as PDFs. The API keeps a bounded queue only while a desktop is disconnected, for memory safety.

**Unchanged:** PIN authorization, Create Session readiness/active lock, the 12+2 minute warning/Continue/End, PDF generation, host microphone, English (UK) caption preference and automatic Meet empty-call guard. Deepgram remains hard-disabled.

## Staging deployment order

1. Push this complete source to the **staging** GitHub branch.
2. Deploy **apps/api** to Railway staging (the new session-scoped `meet_chat` WebSocket path is required).
3. `apps/web` is unchanged, but existing Vercel staging frontend should point to the staging API.
4. Build and install the desktop from **apps/desktop** after ensuring `app-config.json` points to the staging backend. Validate `node -p "require('./package.json').version"` outputs `1.0.5`.

```powershell
cd apps\desktop
npm install
npm run check
npm run dist
```

Installer output: `apps/desktop/dist/Zapper-v1.0.5/Zapper-Setup-x64.exe`.

## Regression coverage

- Desktop checks cover host Meet chat parsing (including Electron's sandboxed preload), system-prompt exclusion, original caption extraction, stable committed nodes, Meet empty-call guard and overlay readiness.
- API tests cover PIN/host-authenticated chat fanout, deduplication, other-session isolation, long messages, Deepgram disabled, transcripts/PDF and 12+2-minute session inactivity.
- Web tests cover the host readiness gate and active-session ownership.

## Live acceptance testing (still required)

Use one host and two distinct PIN-joined computers in a real Google Meet. Speak continuously to confirm settled text does not flicker. Send a message as host in Google Meet and verify both desktops show it. Send messages as each participant and verify both other desktops receive each exactly once. Confirm Google Meet prompts are not rendered as chat, and verify long-message behaviour is governed by Meet. End the session and confirm PDF, PIN invalidation, and Create Session unlock. **Live Windows and Google Meet UI testing was not possible in this offline environment.** Google can change its DOM or chat policy, so no unconditional real-world accuracy guarantee is possible from source tests alone.
