import React from 'react';
import { createRoot } from 'react-dom/client';

const hostSteps = [
  ['Sign in as host', 'Use your host account with a free 24-hour trial or an active subscription.'],
  ['Create a session', 'Click Create Session. Connect your own Google account on first use or when Google requires reconnection.'],
  ['Receive your PIN', 'Zapper requests a Google Meet room and generates the six-digit session PIN automatically.'],
  ['Share the PIN', 'Give the PIN to participants using the Zapper desktop app. Keep this dashboard tab open for host microphone transcription.'],
  ['End and download', 'Mute or unmute your microphone as needed. End the session to finalize its saved transcript PDF.'],
];

const participantSteps = [
  ['Launch Zapper', 'Open the desktop app from the homepage or your installed shortcut. No portal login is required.'],
  ['Enter the PIN', 'Use the six-digit PIN provided by the host.'],
  ['Start transcription', 'Follow the conversation with live voice-to-text and meeting chat.'],
  ['Join the meeting', 'Use the host-provided Google Meet invitation if you also need the meeting audio or video. Google account policies may still restrict entry.'],
];

function StepList({ steps }) {
  return <ol className="journeySteps">{steps.map(([title, text], index) => (
    <li key={title}><span>{index + 1}</span><div><strong>{title}</strong><p>{text}</p></div></li>
  ))}</ol>;
}

export function HowItWorks() {
  return <div className="shellWide">
    <div className="sectionIntro">
      <div className="eyebrow">HOW IT WORKS</div>
      <h2>Clear steps for hosts and participants.</h2>
      <p>Hosts connect their own Google account once, then create a session PIN. Participants launch Zapper and use that PIN for live captions.</p>
    </div>
    <div className="journeyGrid">
      <article className="journeyPanel">
        <div className="journeyHeader"><span className="roleBadge">FOR HOSTS</span><h3>Prepare and manage the session</h3></div>
        <StepList steps={hostSteps} />
      </article>
      <article className="journeyPanel participantJourney">
        <div className="journeyHeader"><span className="roleBadge participantBadge">FOR PARTICIPANTS</span><h3>Join Zapper without a portal login</h3></div>
        <StepList steps={participantSteps} />
      </article>
    </div>
  </div>;
}

export function mountHowItWorks() {
  const root = document.getElementById('howWorksRoot');
  if (root) createRoot(root).render(<HowItWorks />);
}
