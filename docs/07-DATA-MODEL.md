# Data model

Production SQLite file: `/data/zapper.db`.

## users

- id
- email (unique)
- password hash (scrypt + per-user random salt)
- name
- status
- subscription status
- subscription valid-until timestamp
- created timestamp

## host_sessions

- UUID session ID
- owner user ID
- unique 6-digit PIN
- canonical Google Meet URL
- active/ended state
- created / expires / ended timestamps

## transcripts

- UUID transcript ID
- host session ID
- owner user ID
- participant Google email when detectable
- start/end timestamps
- full transcript text
- created timestamp

The portal returns only the latest 20 sessions/transcripts by default. Transcript retention is controlled by `TRANSCRIPT_RETENTION` and defaults to 20 per account.
