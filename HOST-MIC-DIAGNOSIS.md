# Superseded host microphone diagnosis

The earlier host-microphone capture patch used Web UI -> `/stt` and optional Deepgram/browser speech recognition. That is **not** the intended Google Meet microphone path and is **not invoked in this build**. Read `HOST-GOOGLE-MEET-AUTOJOIN.md` for the corrected architecture, mandatory local Chrome/Edge extension and testing limitations.
