# Data model

Production SQLite file: `/data/zapper.db`.

The backend performs safe in-place migrations for databases created by earlier greenfield Zapper builds.

## users

- id
- email (unique)
- password hash (scrypt + per-user random salt)
- name
- role (`host` or `admin`)
- account status (`active` or `disabled`)
- subscription status
- subscription start timestamp
- subscription end timestamp
- last login timestamp
- created timestamp

## host_sessions

- UUID session ID
- owner user ID
- unique 6-digit PIN
- canonical Google Meet URL
- active/ended state
- created / expires / ended timestamps

Only the latest `SESSION_RETENTION` sessions are retained per host; production default is 15. Deleting an old session cascades its transcript record.

## transcripts

- UUID transcript ID
- host session ID
- owner user ID
- participant Google email when detectable
- start/end timestamps
- full transcript text
- stored PDF blob
- PDF filename
- created timestamp

Only the latest `TRANSCRIPT_RETENTION` transcript records are retained per host; production default is 15.
