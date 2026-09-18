# Zapper v3.1.4

Focused update on top of v3.1.3.

- PDF header metadata simplified and aligned: Session PIN, Participant Google sign-in, From, To, Duration. Host account and Google Meet URL removed from the PDF header.
- PDF metadata uses a monospaced aligned block; transcript text and PDF-only pause timestamps remain unchanged.
- Host portal remembers the last Meet URL per signed-in host and restores it in the Meet field.
- After Start Session only, overlay uses a clearer dark-grey translucent background and stronger white transcript typography inspired by the supplied reference. Join/Google/PIN UI remains unchanged.
- Always-on-top enforcement strengthened to a 250 ms non-focus-stealing guard, reasserting content protection and top-most state; accidental native minimize is restored.
- No STT/audio/PIN/session lifecycle logic changed.
