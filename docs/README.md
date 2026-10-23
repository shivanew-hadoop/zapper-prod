# Zapper v4.1.9 — Release guide

**Base:** v4.1.8. **Scope:** five requested UI/reliability fixes, one narrowly scoped PDF-output duplicate filter, and public policies for Cashfree merchant website review. Existing sign-in, Google Meet OAuth, Deepgram live transport, PIN routing, subscription expiry, and desktop runtime are unchanged. This is still a digital subscription product; **Cashfree payment collection has not been integrated** and no charge is made by these website edits.

## Changes

1. **Mobile recording / screen wake:** While a host's browser microphone is recording, the UI requests the standard `navigator.wakeLock.request('screen')` feature and requests again after the page becomes visible. It releases the lock on Mute, End Session, stop or logout. It doesn't add any audio buffering. Unsupported browsers and low-power conditions show a status note. **No web page can promise audio capture after a phone is manually locked, browser suspended, or app moved into the background.** The host must keep Zapper in the foreground and microphone permission enabled.
2. **Homepage order:** How it works is before Features in primary/mobile navigation, public section order, and footer.
3. **Expired 24-hour trial:** A signed-in host with a one-time trial that has ended (and has not been renewed) sees a dismissible subscription notice with +91 93460 73219 and zapperapp.support@gmail.com. The notice does not incorrectly classify an expired paid renewal as the original trial. It appears once per browser page/login lifetime, with normal subscription enforcement unchanged.
4. **Microphone test:** The existing audio test/replay dropdown is now immediately **after Create Session**, titled **Want to test your audio?**, without changing the test code.
5. **PIN clipboard:** The PIN button has a click-to-copy tooltip and visible, screen-reader-announced success/failure feedback. It retains the existing PIN and session behavior.
6. **PDF duplication:** A conservative duplicate filter is applied while assembling the saved PDF transcript. It removes identical or materially overlapping captions within 2.5 seconds from the same capture source or 20 seconds across different/unknown sources. Long-interval and distinct speech are retained. **No filtering, extra latency, or buffering has been added to live captions.** The database's original segment records are left intact.
7. **Cashfree website readiness:** Existing Billing/Cancellation, Refund, Terms, Privacy and Contact pages are retained. Refund/Billing disclosures have been clarified; Contact includes phone support; a Digital Service Delivery/No Shipping page was added. Existing pricing is ₹1,000/month. Nothing advertises Cashfree payment collection as active.

## Deployment

- Push all version 4.1.9 source changes to your existing GitHub `main` branch; deploy `apps/web` via Vercel and **the updated `apps/api` via Railway** (only its PDF finalization output changes). Keep Railway `/data` volume and existing OAuth/Deepgram/JWT variables unchanged. **No database migration.**
- Desktop source functionality is unchanged. Desktop `package.json` is versioned as 4.1.9 for package alignment; a desktop rebuild is not needed to apply the UI/PDF changes.
- Verify `https://api.zapperapp.in/health` reports `4.1.9`, and public pages open without sign-in: `/terms.html`, `/privacy.html`, `/billing.html`, `/refund.html`, `/delivery.html`, `/contact.html`.

## End-to-end test checklist

1. In mobile Chrome/Edge (or supported iOS browser), sign in, start a session, allow microphone permission, confirm status indicates the display is being kept awake, leave browser in foreground with speech for a longer period than the normal screen timeout. Check Mute/Unmute and End Session release/reacquire the screen lock. Verify mobile platform may override on battery saver, background, or lock screen.
2. Confirm homepage scroll order is **How it works → Features**, and header and mobile menu match.
3. Login with a host whose original 24-hour trial expired without renewal: confirm modal with phone/email and Close. Confirm a renewed host and administrator do not get a false trial-expired popup. Repeat on mobile viewport.
4. Confirm mic test dropdown is below Create Session, and sample replay remains local-only.
5. Click PIN on a laptop and Pixel Android: confirm `PIN copied to clipboard`, then paste into an app. Cancel End Session and confirm the session is still active; confirm End Session actually terminates it.
6. With two capture sources in one PIN session, speak some intentionally identical sentences. Confirm live captions still flow promptly, then End Session and download PDF: near-simultaneous repeated lines should appear once while other distinct speech remains. Note: speech-to-text itself can mis-recognize words; timing heuristics cannot perfectly identify every natural repetition.
7. Test another computer under the same host login for isolated PIN/session; confirm trial, subscriptions, Google OAuth, participant PIN access, and transcript/PDF download remain intact.

### Transcription usage and Deepgram costs

- Host web microphone sends its audio to `/stt`, which opens a Deepgram connection when active.
- Each PIN-connected desktop may **also** send captured meeting audio and open its own Deepgram stream if audio is captured. A PIN connection that only receives text captions does not itself need a Deepgram stream.
- Therefore one meeting with host microphone plus one actively capturing desktop **may use two concurrent billable Deepgram audio streams**. With multiple capture clients, the number can be higher. This release's PDF deduplication affects saved text, **not provider billing**. Check usage in Deepgram to measure actual billable minutes. Automatically deduplicating paid audio streams requires a separate explicit audio-source architecture change; it is not included here.

## Cashfree merchant onboarding — remaining items you must supply

Cashfree assesses the real business, not just policy wording. Before applying, ensure the following are accurate and available, and do not invent legal details to pass a website review:

- Legal seller/business name, registration type, billing/business address, authorised representative, PAN/GST information as applicable, and bank/KYC supporting documents. **These were not provided and have NOT been invented in the public site**; add verified business details if the payment provider requires displaying them.
- Confirm the proposed refund support response targets and refund eligibility in the public policy match what your business will actually honor.
- Confirm advertised ₹1,000/month, tax treatment, what customer gets, digital delivery activation time, whether automatic renewal exists, and account-support contact information match the eventual checkout and invoices.
- Make sure `https://www.zapperapp.in` serves all policy pages publicly before Cashfree reviews the site. Digital services have **no physical shipping**.
- Complete Cashfree merchant approval and choose an authorized checkout implementation, secret storage, order creation, webhook verification, and payment reconciliation **before activating payments**. A public policy update cannot guarantee approval and does not process payments.

Official Cashfree website audit criteria include business/product description, pricing, terms, privacy, refund/cancellation policies and contact information. No attempt was made to add Cashfree API keys or payment flows without approved merchant credentials and explicit commercial requirements.

## Tests performed

- Node syntax checks for API/web/desktop JavaScript.
- Isolated PDF-output dedupe unit test and screen-wake lifecycle unit test passed.
- Chromium DOM integration checks (with mocked account and session API) passed for active/expired trial views, navigation order, microphone dropdown placement, PIN copying and End Session Cancel behavior.
- Existing browser-profile session ownership tests and desktop chat filtering tests can run locally without API dependencies.
- The existing full API smoke suite **passed locally**, including registration/trial expiry, Google OAuth, PIN access, host audio authentication, captions, transcript PDF and duplicate filtering. Actual device audio behavior, Cashfree website audit and real production PDF cases require deployment and live testing.
