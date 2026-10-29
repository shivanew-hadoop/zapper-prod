# Zapper desktop – operations and caption behavior

Version: 1.1.1

- Google Meet provides recognition; Electron locally reads the visible caption text. Offline speech recognition is not included.
- Host captions are displayed in Electron immediately and relayed to authorized PIN viewers and backend transcript storage.
- Captions are shown as interim text after a short stabilization window; the collector finalizes after a quiet period. Google Meet's own caption generation and network transport can still contribute latency.
- The 84-term technology substitution module is removed. Captions now reflect Google Meet's actual wording. There is no extra terminology processing layer.
- Finalized transcript lines are appended without history trimming. Scrolling upward disables automatic follow until the viewer returns to the bottom.
- Browser login, subscription/PIN authorization, chat, Deepgram-disabled setting and meeting management remain unchanged.

Build (Windows): from `apps/desktop`, run `npm install`, `npm run check`, then `npm run dist`.

The standalone source ZIP is not an installed app. Deploy the backend/web separately if those services change; this revision changes only desktop-side caption behavior.
