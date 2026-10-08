# Zapper v3.1.5

Focused lifecycle/PDF patch on top of v3.1.4.

- Host-owned session lifecycle: only Host **End Session** can set `active=0`.
- Participant Leave/reopen no longer invalidates the PIN.
- Host browser refresh restores the current active PIN controls and does not touch backend state.
- Silence/legacy expiry no longer auto-end active sessions.
- Same Meet URL may have multiple independently host-controlled active sessions/PINs.
- Active sessions are never deleted by history retention; retention trims ended history only.
- PDF header is compact: participant email + PIN on one row; From/To/Duration on the next row. Host account and Meet URL are absent.
- PDF download regenerates old stored PDFs with the current layout, removing stale host metadata from transcripts created by older builds.
