// Extract person-authored lines from a Google Meet CHAT container only.
// Caller must scope this to a visible Meet chat panel; never scan whole page.
const SYSTEM = new Set([
  'are you still there?', 'stay in the call', 'leave now',
  'the call ended because everyone left', 'loading invitees',
  'view everyone in this call', 'send a message', 'message everyone',
  'in-call messages', 'chat with everyone', 'meeting details', 'leave call',
  'join now', 'someone wants to join', 'messages will not be saved',
  'continuous chat is turned off', 'turn on captions', 'turn off captions',
  'message sent', 'could not send message', 'pin message', 'pinned message',
  'chat here', 'online trainings'
]);
function tidy(input) { return String(input || '').replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').trim(); }
function isClock(s) { return /^\d{1,2}:\d{2}(?:\s?(?:AM|PM))?$/i.test(tidy(s)); }
function system(s) {
  const value = tidy(s).toLowerCase();
  return !value || SYSTEM.has(value) || /^\d+ joined$/.test(value) ||
    (/are you still there\?/i.test(value) && /stay in the call/i.test(value));
}
function name(s) {
  const value = tidy(s);
  if (!value || value.length > 80 || system(value) || isClock(value)) return false;
  return /^(you|me)$/i.test(value) || /^[\p{L}\p{N}][\p{L}\p{N}.'@_\-]*(?:\s+[\p{L}\p{N}][\p{L}\p{N}.'@_\-]*){0,5}$/u.test(value);
}
function splitLines(raw) {
  const out = [];
  for (const row of String(raw || '').replace(/\u00a0/g, ' ').split(/\r?\n/)) {
    const s = tidy(row);
    if (!s || /^(AM|PM)$/i.test(s)) continue;
    const match = s.match(/\b\d{1,2}:\d{2}(?:\s?(?:AM|PM))?\b/i);
    if (!match) { out.push(s); continue; }
    const before = tidy(s.slice(0, match.index));
    const after = tidy(s.slice(match.index + match[0].length));
    if (before) out.push(before);
    out.push(match[0]);
    if (after) out.push(after);
  }
  return out;
}
function parseRows(raw, explicitSender = '') {
  const lines = splitLines(raw);
  const clockIndices = lines.map((line, i) => isClock(line) ? i : -1).filter(i => i >= 0);
  const result = [], occurrences = new Map();
  for (let t = 0; t < clockIndices.length; t++) {
    const idx = clockIndices[t], next = clockIndices[t + 1] ?? lines.length;
    const before = lines[idx - 1] || '';
    const sender = name(explicitSender) ? explicitSender : name(before) ? before : '';
    if (!sender) continue;
    const messageLines = [];
    for (let j = idx + 1; j < next; j++) {
      const line = lines[j];
      if (isClock(line)) continue;
      if (j === next - 1 && next < lines.length && name(line)) continue;
      if (line === sender || system(line)) continue;
      messageLines.push(line);
    }
    const message = tidy(messageLines.join('\n'));
    if (!message || system(message)) continue;
    const label = /^(you|me)$/i.test(sender) ? 'Host' : sender;
    const key = `${label.toLowerCase()}|${lines[idx].toLowerCase()}|${message.toLowerCase()}`;
    const ordinal = occurrences.get(key) || 0;
    occurrences.set(key, ordinal + 1);
    result.push({ sender: label, meetTime: lines[idx], message, chatKey: key + '|' + ordinal });
  }
  return result;
}
module.exports = { parseRows, system, isClock };
