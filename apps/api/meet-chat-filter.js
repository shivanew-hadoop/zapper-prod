// Shared server-side guard: Google Meet chrome is not a person-authored chat.
// Only exact notices/control labels are filtered. Normal sentences containing
// words like "leave", "meeting", or "joined" must pass through unchanged.
const NOISE = new Set([
  'are you still there?', 'stay in the call', 'leave now', 'the call ended because everyone left',
  'loading invitees', 'view everyone in this call', 'send a message', 'message everyone',
  'in-call messages', 'chat with everyone', 'meeting details', 'leave call', 'join now',
  'someone wants to join', 'messages will not be saved', 'continuous chat is turned off',
  'turn on captions', 'turn off captions', 'message sent', 'could not send message',
  'pin message', 'pinned message', 'chat here'
]);
function normalizeMeetChat(payload, isHost = false) {
  const message = String(payload?.message || '').trim();
  const originalSender = String(payload?.sender || '').trim();
  const sender = /^(you|me)$/i.test(originalSender) ? (isHost ? 'Host' : 'Participant') : originalSender;
  const key = value => String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
  if (!sender || !message || Buffer.byteLength(message, 'utf8') > 256 * 1024) return null;
  if (NOISE.has(key(message)) || NOISE.has(key(sender)) || /^\d+ joined$/.test(key(message))) return null;
  if (/^are you still there\?/i.test(message) && /stay in the call/i.test(message)) return null;
  if (/^(?:admin|system|google meet|meet notification)$/i.test(sender)) return null;
  return { sender, message, meetTime: String(payload.meetTime || '').slice(0, 32),
    chatKey: String(payload.chatKey || '').slice(0, 512), timestamp: Date.now() };
}
module.exports = { normalizeMeetChat };
