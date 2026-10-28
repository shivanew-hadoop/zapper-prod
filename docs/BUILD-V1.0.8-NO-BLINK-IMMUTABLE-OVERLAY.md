# Zapper desktop v1.0.8 — no-blink overlay / permanent printed words

Based directly on v1.0.7. This is a **desktop-only** patch; API and web runtime files are unchanged. Deepgram remains disabled.

## What changed

1. **Native window flicker:** `apps/desktop/main.js` no longer raises the protected overlay (`moveTop`) every 250 ms. The topmost health check now runs every 5 seconds and only restores topmost when Windows actually loses it. Browser host control deep links also stop repeatedly showing/focusing an already visible overlay.
2. **Cursor-induced compositing:** Removed the second transparent always-on-top cursor BrowserWindow and its 16 ms native `setBounds` polling loop. The existing SVG pointer now renders *inside the same capture-protected overlay* and follows DOM pointer events. The content protection flag is retained.
3. **Permanent caption ink:** `apps/desktop/overlay/overlay.js` only paints a provisional word after it appears in consecutive caption updates. Visible words are appended as separate immutable text nodes; final captions append unprinted words rather than replacing any visible word. If Meet corrects an already printed word, Zapper keeps the original visible and displays the corrected final sentence separately rather than silently erasing speech.
4. **No 100-line erase:** Removed the live-view transcript trim that used to clear and rebuild the entire caption view after 100 finalized lines. Old words stay scrollable for the session.
5. **Host relay interruption:** Temporary peer-caption authorization loss no longer triggers a fake host-session-stopped event that clears the host overlay; actual session end or time limit still behaves as before.

No changes to Google Meet recognition/language, caption transport, group chat, PIN handling, host authentication, inactivity prompt, transcript/PDF generation, or the forced Deepgram-off configuration.

## Build

In `apps/desktop`:

```powershell
node -p "require('./package.json').version"  # 1.0.8
npm install
npm run check
npm run dist
```

For low disk space on D:, use `npm run dist -- --config.directories.output=E:\\ZapperBuild` on a drive with free space.

## Staging validation checklist (Windows / Google Meet)

- Run a host + two PIN viewers for 15+ minutes. Move the mouse in and out of the protected overlay; inspect full-window flicker, typing, dragging and resizing.
- Confirm each spoken word, once visible, stays on screen and old caption lines remain available after 100+ lines and during source correction/relay reconnect.
- Verify normal caption latency and that Google Meet's **English (UK)** selection, live relay, group chat, Keep in Call safeguard, and PDF End Session still work.
- Confirm that screenshots/screen sharing do not capture the protected overlay or its custom pointer on supported Windows capture paths.

Automated checks pass on the source; a live Windows GPU/compositor check is still necessary. No engineering change can honestly guarantee every possible Windows compositor/driver combination will never flicker without that verification.
