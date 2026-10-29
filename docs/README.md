# Zapper — desktop notes

## Runtime

Google Meet generates speech captions. The host Electron window reads displayed Meet captions, corrects known technical spellings with an exact local dictionary, and sends text to the authenticated caption relay. PIN-authorized viewers receive the relay while their separate Meet admission is pending. Deepgram is disabled.

## Stability and display

A short interim stabilization interval reduces volatile Meet revisions. Finalized lines are append-only, and scrolling back must not trim existing lines. Google Meet recognition, host upload, and the relay network can still contribute delay.

## Build and test

From `apps/desktop`, run `npm install`, `npm run check`, then `npm run dist` on Windows for an installer. This source ZIP does not deploy the app or backend.
