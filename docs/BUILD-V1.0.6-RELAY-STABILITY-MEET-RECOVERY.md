# Zapper Desktop 1.0.6 — Narrow regression patch on 1.0.5

This is the **full original v1.0.5 project plus focused fixes**. No changes to host login, PIN authorization, Create Session gating/ownership, 12+2-minute inactivity policy, PDFs, Meet language preference (English UK), Google microphone handling or Deepgram configuration. **Deepgram remains hard OFF** on desktop and API.

## Fixes

1. **Overlay flashing:** Completed caption lines now retain individual immutable DOM nodes. The interim sentence also has append-only stable word nodes; only the newest two words stay editable. Removed repeated multi-animation-frame scroll restoration. Live Meet corrections can still alter the latest provisional words, but cannot rewrite completed lines.
2. **PIN captions stopping or arriving together:** The desktop no longer blocks every host relay message forever after its first local caption. While host captions are arriving it uses the host relay for a consistent shared feed, and it falls back to the local Meet observer if that feed goes quiet. The API prioritizes the host source when both host and PIN windows observe the same speech. A normal WebSocket close now triggers reconnect if the session is still active. After reconnect, stored final captions go to the PDF ledger **without flooding viewers' live overlays**.
3. **Chat delivery:** The Zapper overlay Send action uses the authenticated session WebSocket group relay directly, rather than relying on Google Meet finding a send textbox. Host -> all PIN users and PIN user -> host/other PIN users are supported by the same session relay. Existing Meet chat observation is retained, including messages without a visible timestamp when author/message ID can be verified; Meet administrative prompts remain excluded. Normal chat is not silently truncated to 8,000 characters; the API still applies its existing abuse-safety message size guard. Queued sends during brief disconnects are retried when reconnected. **The Zapper group message is not automatically written into the Google Meet chat room**.
4. **Google's “stay or leave” timeout:** Checks and clicks the actual Stay control even when the modal hides Meet's Leave Call button. Added a guarded rejoin **only if Google Meet explicitly shows a terminal “everyone left” screen**. A normal live call, a silent microphone, or missing Zapper PIN viewers never triggers a reload. Attempts are capped to three per ten minutes, and the existing 12+2 Zapper inactivity policy is unchanged.

Google still controls admission, Meet participant counting, caption recognition, chat DOM and the empty-call policy. A Zapper PIN observer is **not automatically a Google Meet participant**. No source-only test can guarantee that Google's UI will never show a prompt or that captions always reach viewers within a specified number of milliseconds.

## Deployment — staging first

1. Push to GitHub `staging` and deploy `apps/api` to your **Railway staging** service.
2. In `apps/desktop/app-config.json`, ensure the backend URL points to the **staging** API before building.
3. In `apps/desktop`, run `npm install`, `npm run check`, then `npm run dist`.
4. Confirm desktop `node -p "require('./package.json').version"` returns **1.0.6**. Electron Builder output is in `apps/desktop/dist/Zapper-v1.0.6/`.
5. The web source remains unchanged and its Vercel staging environment should point to the staging API.

## Minimum real-world acceptance test (Windows + Google Meet)

- One host + two separate PIN desktops, all running 1.0.6 connected to the **same staging API**.
- Speak continuously for several minutes. Final lines must stay visually unchanged; only the newest two provisional words may correct. Verify both PIN overlays display host speech without accumulating a several-second backlog.
- Send Zapper overlay chat from host and from each PIN desktop, including a long message. Check that the other two desktops receive each message and that nobody sees Meet system prompts as messages.
- Leave a Meet window as the only **admitted Meet participant** to reproduce Google's 10-minute warning. Confirm the safeguard presses Stay when that identified prompt appears. If Google itself ends the room, verify controlled rejoin only when the terminal message is detected.
- End Session on the host site. Confirm the PIN closes, transcript PDF is saved, and Create Session becomes available according to the existing lock rules.

Automated desktop, API and web regression tests are included. A live Windows/Google Meet call and an installer build are **not** executable in this environment, so those acceptance checks must still be completed in staging.
