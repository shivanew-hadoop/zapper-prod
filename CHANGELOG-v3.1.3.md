# Zapper v3.1.3

Focused update on top of v3.1.2 only.

- Explicit `host_sessions.active` flag; host End Session, participant Leave, expiry, and idle timeout set it to `0`.
- Creating the same Meet again generates a fresh active PIN and retires the older active PIN.
- A participant-started session auto-ends after 20 minutes without detected speech (`SESSION_IDLE_TIMEOUT_MINUTES`).
- The connected desktop is notified and automatically saves the available transcript, leaves Meet, and returns to the PIN screen.
- Native Windows resize borders are disabled; protected renderer resize zones remove the public OS horizontal/diagonal resize cursor artifact.
- The private cursor remains renderer-owned across the whole overlay, including header and resize zones.
- PDF-only pause timestamps: after a 30+ second gap, the stored PDF inserts a small 24-hour IST marker. The live overlay is unchanged.
- Timestamp metadata is collected locally with final transcript lines and used only during end-of-session PDF generation; no extra network request is added to live transcription.
