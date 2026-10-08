# Zapper v3.1.7 desktop close/rejoin reliability fix

Focused patch only; web, API, host/admin, PDF, session lifecycle and private-cursor behavior are unchanged.

- Overlay X is now a true process exit: hidden Meet/Google/cursor windows and local relay are destroyed, shortcuts are released, and Electron exits with code 0. Relaunch no longer requires Task Manager.
- Local Meet-audio relay now remains stable across participant Leave -> Rejoin cycles and is stopped only when the desktop process exits.
- Meet window cleanup is instance-safe so a previous hidden Meet window cannot clear the newly-created Meet window or its join poller.
- Remote STT WebSocket events are generation-scoped so delayed close/error events from the previous session cannot null or stop the new transcription stream.
- Same active host PIN can therefore be left and re-entered repeatedly until the host explicitly ends the session.
