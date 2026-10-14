import React from 'react';
import { createRoot } from 'react-dom/client';

const hostSteps = [
  ['Sign in as host', 'Use your host account with a free 24-hour trial or an active subscription.'],
  ['Create the Google Meet link', 'Create the Google Meet from your Google account first.'],
  ['Enter the Google Meet in Zapper', 'Paste the created Google Meet link or meeting ID into Zapper and create the session.'],
  ['Share the PIN', 'Give the generated six-digit PIN to the participant and keep the session active until you end it.'],
  ['Admit the participants', 'Open the Google Meet and approve participant join requests when they arrive.'],
];

const participantSteps = [
  ['Launch Zapper', 'Open the desktop app from the homepage or your installed shortcut. No portal login is required.'],
  ['Enter the PIN', 'Use the six-digit PIN provided by the host.'],
  ['Start transcription', 'Follow the conversation with live voice-to-text and meeting chat.'],
  ['Ask the host to admit you', 'If Google Meet is waiting for approval, follow up with the host so they can admit your entry.'],
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
      <p>Hosts prepare the Google Meet and Zapper session. Participants launch Zapper, enter the PIN and follow the meeting.</p>
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
