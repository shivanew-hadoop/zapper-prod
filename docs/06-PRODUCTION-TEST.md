# 6 — Production acceptance test

Do this in order with one real Google Meet.

## A. Backend

- `https://api.zapperapp.in/health` returns `ok:true`.
- `deepgramConfigured` is `true`.
- Railway volume is attached at `/data`.

## B. Portal account

- Register a new test email at `https://zapperapp.in`.
- Log out and log in again.
- Use the admin helper to activate it for 30 days.
- Refresh and confirm Subscription = Active.

## C. Session

- Enter `abc-defg-hij` format or a complete Meet URL.
- Create Session.
- Confirm a 6-digit PIN appears.
- Refresh Recent Sessions and confirm the same session is listed.

## D. Desktop/PIN binding

- Start the desktop app.
- Complete Google Sign-In when prompted.
- Enter the 6-digit PIN only.
- Confirm the participant does not manually enter the Meet URL.
- Confirm the correct Meet opens.

## E. Transcript

- Speak in Meet and confirm live text arrives.
- Scroll upward in the transcript and verify new text does not move the reading position until you return to the bottom.
- Leave/Stop the meeting.
- Return to the portal and refresh Saved Transcripts.
- Confirm a transcript appears with start/end time and session PIN.
- Download PDF and confirm transcript content is present.

## F. Persistence/redeploy

- Redeploy the Railway service without wiping the volume.
- Log in again.
- Confirm user account, session history and transcript are still available.

## G. Failure cases

- Inactive host account cannot create a new session.
- Wrong 6-digit PIN is rejected.
- Expired PIN is rejected.
- Invalid Meet code is rejected at session creation.
- Desktop without Google Sign-In shows the sign-in requirement before joining.
