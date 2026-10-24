// meet-preload.js — Google Meet captions first; remote-audio tap remains available only for Deepgram fallback
(() => {
  let ipcRenderer = null;
  try { ipcRenderer = require('electron').ipcRenderer; } catch (_) {}

  const WS_URL = 'ws://localhost:9999';
  const TARGET_RATE = 16000;

  let ws;
  const peerConnections = new Set();
  const capturedTracks = new WeakSet();

  let audioCtx = null;
  let mixBus = null;
  let processor = null;
  let zeroGain = null;
  let startedProcessor = false;
  let sentLog = false;
  let inputCarry = new Float32Array(0);

  function log(...args) { console.log('[GMeetTap]', ...args); }

  function connectWS() {
    try {
      ws = new WebSocket(WS_URL);
      ws.binaryType = 'arraybuffer';
      ws.onopen = () => log('Connected to local audio relay');
      ws.onclose = () => setTimeout(connectWS, 700);
      ws.onerror = (e) => log('Audio relay error', e && e.message ? e.message : e);
    } catch (_) { setTimeout(connectWS, 700); }
  }
  connectWS();


  // Google Meet chat bridge.
  // v1.1.9: single clean incoming path. The previous zip had multiple old parsers in this
  // file; the last broken parser overrode the restored parser. This section keeps one parser only.
  const seenChatMessages = new Map();
  const recentLocalOutgoingChat = new Map();
  let chatObserverInstalled = false;
  let knownChatRoot = null;
  let lastOpenChatAttemptAt = 0;
  let lastIncomingSnapshot = '';
  let autoChatHereSent = false;
  let inMeetingStableSince = 0;

  function normalizeText(value) {
    return String(value || '')
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t\r\f\v]+/g, ' ')
      .replace(/\s+\n/g, '\n')
      .replace(/\n\s+/g, '\n')
      .trim();
  }

  function textLines(value) {
    return String(value || '')
      .replace(/\u00a0/g, ' ')
      .split('\n')
      .map(v => normalizeText(v))
      .filter(Boolean);
  }

  function keyText(value) {
    return normalizeText(value).toLowerCase().replace(/\s+/g, ' ').slice(0, 4000);
  }

  function isClockText(value) {
    return /^\d{1,2}:\d{2}(\s?[AP]M)?$/i.test(normalizeText(value));
  }

  function isStandaloneMeridiem(value) {
    return /^(AM|PM)$/i.test(normalizeText(value).replace(/[.]/g, ''));
  }

  function isSelfText(value) {
    return /^(you|me)$/i.test(normalizeText(value));
  }

  // Meet's inactivity/leave prompt is application chrome, never chat.
  // Match exact UI labels instead of broad keywords so normal user chat stays intact.
  function isMeetInactivityPrompt(value) {
    const text = keyText(value).replace(/\s+/g, ' ').trim();
    return /^(?:are you still there\??|leave now|stay in the call|to stop seeing this, go to settings\s*>\s*general\.?|to stop seeing this go to settings general\.?)$/i.test(text) ||
      (/are you still there\?/i.test(text) && /leave now/i.test(text) && /stay in the call/i.test(text));
  }

  function isMeetNoise(value) {
    const t = keyText(value);
    if (!t) return true;
    if (isMeetInactivityPrompt(t)) return true;
    if (isClockText(t)) return false;
    const exact = new Set([
      'ready to join?', 'ask to join', 'join now', 'meeting_room', 'present', 'present now', 'present_to_all',
      'share screen', 'computer_arrow_up', 'show fewer options', 'show more options', 'more options', 'more_vert',
      'expand_less', 'expand_more', 'keyboard_arrow_up', 'keyboard_return', 'chevron_right', 'mic', 'mic_none',
      'microphone', 'audio settings', 'video settings', 'easycamera', 'camera', 'videocam', 'leave call',
      'call_end', 'send a reaction', 'mood', 'closed_caption_off', 'back_hand', 'apps', 'meeting tools',
      'people', 'activities', 'chat', 'in-call messages', 'meeting details', 'google meet', 'meet chat forwarded',
      'companion mode', 'ask to use companion mode', 'pin message', 'pin messages', 'pinned message', 'pinned messages',
      'close', 'send', 'send message', 'chat_bubble', 'frame_person', 'reframe', 'visual_effects', 'captions controls',
      'backgrounds and effects', 'keep', 'sent', 'sending', 'message sent', 'could not send message', 'online trainings',
      'message everyone', 'send a message', 'messages will not be saved', 'continuous chat is turned off',
      'loading invitees', 'view everyone in this call', 'show everyone', 'people in this call', 'add people', 'participants'
    ]);
    if (exact.has(t)) return true;
    return /^(microphone array.*|turn off microphone.*|turn on microphone.*|turn off camera.*|turn on camera.*|turn on captions.*|turn off captions.*|raise hand.*|loading invitees.*|view everyone in this call|\d+ joined|chat with everyone.*|continuous chat is turned off.*|messages will not be saved.*|reframe.*|backgrounds and effects.*|captions controls.*|someone wants to join.*)$/i.test(t) ||
      /qgv-[a-z0-9]+-[a-z0-9]+|press down arrow to open the hover tray|escape to close it|more options for|mic_off|videocam_off|frame_person|visual_effects|backgrounds and effects|reframe|keyboard_return|chat_bubble|meeting_room|present_to_all|captions controls/i.test(t);
  }

  function stripMeetNoise(value) {
    let t = normalizeText(value);
    t = t.replace(/qgv-[a-z0-9]+-[a-z0-9]+/ig, ' ');
    t = t.replace(/\b(info|mic_off|videocam_off|keyboard_return|chat_bubble|frame_person|visual_effects|meeting_room|present_to_all|chevron_right|expand_less|expand_more)\b/ig, ' ');
    t = t.replace(/\bPress Down Arrow to open the hover tray and Escape to close it\.?/ig, ' ');
    t = t.replace(/\bMore options for\b/ig, ' ');
    return normalizeText(t);
  }

  function cleanChatLine(value, keepTime = true) {
    const t = stripMeetNoise(value);
    if (!t) return '';
    if (isClockText(t)) return keepTime ? t : '';
    // Google Meet sometimes renders the time as two visual fragments: "12:09" and "AM".
    // The AM/PM fragment is timestamp metadata, not a chat message.
    if (isStandaloneMeridiem(t)) return '';
    if (isMeetNoise(t)) return '';
    return t;
  }

  function splitMeetChatLine(line) {
    const out = [];
    let t = normalizeText(line);
    if (!t) return out;

    // Google Meet changes DOM frequently. Sometimes message rows render as:
    //   "Sender 10:39 PM Message"
    // instead of three separate innerText lines. Split the clock out so the
    // existing row parser can still understand sender/time/message reliably.
    const clockRe = /\b\d{1,2}:\d{2}(?:\s?(?:AM|PM))?\b/i;
    let guard = 0;
    while (t && guard++ < 6) {
      const m = t.match(clockRe);
      if (!m) { out.push(t); break; }
      const before = normalizeText(t.slice(0, m.index).replace(/[,;:|\-]+$/g, ''));
      const clock = normalizeText(m[0]);
      const after = normalizeText(t.slice(m.index + m[0].length).replace(/^[,;:|\-]+/g, ''));
      if (before) out.push(before);
      out.push(clock);
      t = after;
    }
    return out;
  }

  function cleanChatLines(value) {
    const expanded = [];
    for (const rawLine of textLines(value)) {
      for (const part of splitMeetChatLine(rawLine)) {
        const cleaned = cleanChatLine(part, true);
        if (cleaned) expanded.push(cleaned);
      }
    }
    return expanded;
  }

  function visible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
  }

  function rememberLocalOutgoing(message) {
    const key = keyText(message);
    if (!key) return;
    recentLocalOutgoingChat.set(key, Date.now());
    cleanupChatMemory();
  }

  function isRecentLocalOutgoing(message) {
    const key = keyText(message);
    if (!key) return false;
    const ts = recentLocalOutgoingChat.get(key);
    return !!ts && Date.now() - ts <= 30 * 60 * 1000;
  }

  try { window.__zapperRememberLocalOutgoingChat = rememberLocalOutgoing; } catch (_) {}

  function cleanupChatMemory() {
    const now = Date.now();
    for (const [key, ts] of seenChatMessages.entries()) {
      if (now - ts > 3 * 60 * 60 * 1000) seenChatMessages.delete(key);
    }
    for (const [key, ts] of recentLocalOutgoingChat.entries()) {
      if (now - ts > 30 * 60 * 1000) recentLocalOutgoingChat.delete(key);
    }
  }

  function clickMeetButtonByText(patterns) {
    const nodes = [...document.querySelectorAll('button, div[role="button"], span[role="button"], a[role="button"]')].filter(visible);
    for (const el of nodes) {
      const text = normalizeText([
        el.getAttribute('aria-label'),
        el.getAttribute('data-tooltip'),
        el.getAttribute('title'),
        el.innerText,
        el.textContent
      ].filter(Boolean).join(' ')).toLowerCase();
      if (patterns.some(p => text.includes(p))) {
        try { el.click(); return true; } catch (_) {}
        try {
          el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
          el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
          el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
          return true;
        } catch (_) {}
      }
    }
    return false;
  }

  function findChatInput() {
    const inputs = [...document.querySelectorAll('textarea, input[type="text"], input:not([type]), [contenteditable="true"], div[role="textbox"], [role="textbox"]')]
      .filter(visible)
      .filter(el => {
        const hint = normalizeText([
          el.getAttribute('aria-label'),
          el.getAttribute('placeholder'),
          el.getAttribute('data-tooltip'),
          el.getAttribute('title'),
          el.textContent
        ].filter(Boolean).join(' ')).toLowerCase();
        return el.getAttribute('role') === 'textbox' || el.isContentEditable || /send.*message|message.*everyone|message everyone|send a message|chat|message/i.test(hint);
      });
    return inputs.find(el => /send.*message|message.*everyone|message everyone|send a message/i.test(normalizeText(el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('data-tooltip') || ''))) || inputs[inputs.length - 1] || null;
  }

  function scoreChatRoot(el, input) {
    if (!el || !visible(el)) return -999;
    const txt = normalizeText(el.innerText || el.textContent || '').toLowerCase();
    const r = el.getBoundingClientRect();
    let score = 0;
    if (input && el.contains(input)) score += 80;
    if (/in-call messages|chat with everyone|message everyone|send a message|continuous chat/i.test(txt)) score += 45;
    if (/people in this call|loading invitees|view everyone in this call|participants|captions controls|ready to join|ask to join/i.test(txt)) score -= 80;
    if (r.width >= 180 && r.height >= 120) score += 15;
    if (r.width > 950 || r.height > 950) score -= 35;
    return score;
  }

  function findMeetChatRoot() {
    const input = findChatInput();
    if (knownChatRoot && document.body.contains(knownChatRoot) && (!input || knownChatRoot.contains(input))) return knownChatRoot;

    let best = null;
    let bestScore = -999;
    if (input) {
      let el = input;
      for (let depth = 0; el && depth < 14; depth += 1, el = el.parentElement) {
        const score = scoreChatRoot(el, input);
        if (score > bestScore) { best = el; bestScore = score; }
      }
    }

    const panels = [...document.querySelectorAll('[role="dialog"], [aria-modal="true"], [aria-label], div')].filter(visible);
    for (const el of panels) {
      const score = scoreChatRoot(el, input);
      if (score > bestScore) { best = el; bestScore = score; }
    }

    knownChatRoot = bestScore >= 25 ? best : null;
    return knownChatRoot;
  }

  function isInMeeting() {
    const txt = normalizeText(document.body && document.body.innerText || '').toLowerCase();
    // Treat Meet as admitted only after the real in-call UI is visible.
    // Pre-join / waiting-room pages can still contain chat/people labels, so do not
    // open chat or auto-send the init message from those states.
    if (/ready to join|ask to join|join now|waiting for host admission|waiting to be admitted|someone will let you in|you.ll join when someone lets you in|asking to be joined/i.test(txt)) return false;
    return /leave call|you are in the meeting|you are in this call/i.test(txt);
  }


  // Primary transcription path: Google Meet native captions.
  //
  // IMPORTANT: jsname="tgaKEf" is a caption CONTAINER in current Meet builds,
  // but its whole textContent must never be treated as speech. Meet can place
  // controls/announcements near that container. We only extract known nested
  // speaker/text blocks, with structured aria-live fallbacks for UI variants.
  const CAPTION_LABEL_WORDS = [
    'caption', 'subtitle', 'untertitel', 'sous-titre', 'sottotitoli',
    'subtítulo', 'subtitulo', 'legenda', 'ondertiteling', 'napisy',
    'субтитры', '字幕', '자막'
  ];
  const CAPTION_REGION_SELECTOR = CAPTION_LABEL_WORDS
    .map(word => `[role="region"][aria-label*="${word}" i]`).join(', ');
  const CAPTION_LABELLED_SELECTOR = CAPTION_LABEL_WORDS
    .map(word => `[aria-label*="${word}" i]`).join(', ') + ', [jsname="tgaKEf"], [jsname="DS9Ooe"]';
  const CAPTION_EXCLUDED_ANCESTOR_SELECTOR = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="menubar"], [role="toolbar"], [role="tablist"], [role="listbox"], button, [role="button"], [data-panel-id]';

  let captionObserver = null;
  let captionObservedRoot = null;
  let captionActiveStrategy = null;
  let captionReadySent = false;
  let captionAdmittedSent = false;
  let lastCaptionKey = '';
  let lastCaptionText = '';
  let lastCaptionChangedAt = 0;
  let lastCaptionFinalKey = '';
  let captionFinalTimer = null;
  let lastCaptionEnableAttemptAt = 0;

  function emitCaptionState(state, extra = {}) {
    if (!ipcRenderer) return;
    ipcRenderer.send('meet-caption-state', { state, at: Date.now(), ...extra });
  }

  function isCaptionChrome(value) {
    const t = normalizeText(value).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_\s]+/g, ' ').toLowerCase().trim();
    if (!t) return true;
    return /^(?:arrow downward?|arrow down|jump to bottom|arrow downward? jump to bottom)$/i.test(t) ||
      /^(?:captions?|closed captions?|captions controls?|turn (?:on|off) captions?)$/i.test(t);
  }

  const MEET_ANNOUNCEMENT_RE = new RegExp([
    'panel is (open|closed)',
    '\\b(your|the)\\b.{0,20}\\b(camera|microphone)\\b',
    '\\b(camera|microphone)\\b.{0,20}\\b(is )?(on|off)\\b',
    '\\b(joined|left)\\b.{0,30}\\b(meeting|call)\\b',
    '\\b(joined|left)\\s*$',
    'wants to join|admit or deny',
    '\\b(is|are)\\s+(now\\s+)?(presenting|pinned|muted|unmuted)',
    '\\brecording\\b.{0,20}\\b(started|stopped)',
    'raised (their )?hand',
    'you are the only (one|person) here',
    'access and management is limited',
    'ask and answer questions',
    '^q&a$'
  ].join('|'), 'i');

  function isMeetAnnouncement(value) {
    const t = normalizeText(value);
    return Boolean(t && t.length < 160 && MEET_ANNOUNCEMENT_RE.test(t));
  }

  function cleanCaptionSpeaker(value) {
    const t = normalizeText(value);
    if (!t || t.length > 100 || isMeetNoise(t) || isCaptionChrome(t) || isClockText(t) || isMeetAnnouncement(t)) return '';
    return t;
  }

  function cleanCaptionText(value, speaker = '') {
    let text = normalizeText(value);
    if (!text || isCaptionChrome(text)) return '';
    text = normalizeText(text
      .replace(/^arrow_downward\s*/i, '')
      .replace(/^arrow down(?:ward)?\s*/i, '')
      .replace(/\s*arrow_downward\s*jump to bottom\s*$/i, '')
      .replace(/\s*arrow down(?:ward)?\s*jump to bottom\s*$/i, ''));
    if (!text || isCaptionChrome(text)) return '';
    const cleanSpeaker = cleanCaptionSpeaker(speaker);
    if (cleanSpeaker && text.toLowerCase().startsWith(cleanSpeaker.toLowerCase())) {
      text = normalizeText(text.slice(cleanSpeaker.length).replace(/^[:\-–—]+\s*/, ''));
    }
    if (!text || isMeetNoise(text) || isCaptionChrome(text) || isClockText(text) || isMeetAnnouncement(text)) return '';
    return text.slice(0, 12000);
  }

  function isInDialog(el) {
    try { return Boolean(el?.closest?.('[role="dialog"], [role="alertdialog"]')); } catch (_) { return false; }
  }

  function isExcludedCaptionElement(el) {
    if (!el) return true;
    try { return Boolean(el.closest?.(CAPTION_EXCLUDED_ANCESTOR_SELECTOR)); } catch (_) { return false; }
  }

  function looksLikeCaptionRegion(el) {
    if (!el || isInDialog(el)) return false;
    try {
      if (el.closest(CAPTION_LABELLED_SELECTOR)) return true;
    } catch (_) {}
    for (const block of [...(el.children || [])]) {
      const kids = [...(block.children || [])].filter(k => normalizeText(k.textContent || '').length > 0);
      if (kids.length >= 2) return true;
    }
    return false;
  }

  // Current stable jsname path used by Meet caption capture tools:
  // container tgaKEf/DS9Ooe -> block YSxPC -> speaker r4nke -> text bVV8Bd.
  // We never read container.innerText/textContent as a transcript.
  function extractByJsname(container) {
    const entries = [];
    if (!container || isInDialog(container)) return entries;
    for (const block of container.querySelectorAll('[jsname="YSxPC"]')) {
      if (isExcludedCaptionElement(block)) continue;
      const speakerEl = block.querySelector('[jsname="r4nke"]');
      const textEl = block.querySelector('[jsname="bVV8Bd"]');
      if (!textEl) continue;
      const speaker = cleanCaptionSpeaker(speakerEl?.textContent || '');
      const text = cleanCaptionText(textEl.textContent || '', speaker);
      if (text) entries.push({ speaker, text });
    }
    return entries;
  }

  // Current class-based path retained as a second independent strategy.
  function extractByCurrentClasses(container) {
    const entries = [];
    if (!container || isInDialog(container)) return entries;
    const rows = [...container.querySelectorAll('div.nMcdL.bj4p3b')];
    for (const row of rows) {
      if (isExcludedCaptionElement(row)) continue;
      const textEl = row.querySelector('div.ygicle.VbkSUe, div.ygicle');
      if (!textEl) continue;
      const speakerEl = row.querySelector('div.NWpY1d');
      const speaker = cleanCaptionSpeaker(speakerEl?.textContent || '');
      const text = cleanCaptionText(textEl.textContent || '', speaker);
      if (text) entries.push({ speaker, text });
    }
    return entries;
  }

  function extractByPosition(container) {
    const entries = [];
    if (!container || isInDialog(container) || !looksLikeCaptionRegion(container)) return entries;
    for (const block of [...(container.children || [])]) {
      if (!block || isExcludedCaptionElement(block)) continue;
      const textKids = [...(block.children || [])]
        .filter(el => !isExcludedCaptionElement(el))
        .map(el => ({ el, text: normalizeText(el.textContent || '') }))
        .filter(item => item.text && !isMeetAnnouncement(item.text) && !isCaptionChrome(item.text));
      if (textKids.length < 2) continue;
      const speaker = cleanCaptionSpeaker(textKids[0].text);
      if (!speaker || speaker.length > 60) continue;
      const text = cleanCaptionText(textKids.slice(1).map(item => item.text).join(' '), speaker);
      if (text) entries.push({ speaker, text });
    }
    return entries;
  }

  function findAriaLiveContainer() {
    const candidates = [...document.querySelectorAll('[aria-live="polite"], [aria-live="assertive"]')]
      .filter(el => !isInDialog(el))
      .filter(el => (el.children?.length || 0) > 0)
      .filter(el => !isMeetAnnouncement(normalizeText(el.textContent || '')))
      .filter(looksLikeCaptionRegion);
    if (!candidates.length) return null;
    return candidates.sort((a, b) => (b.children?.length || 0) - (a.children?.length || 0))[0];
  }

  const CAPTION_STRATEGIES = [
    {
      name: 'jsname-tgaKEf',
      findContainer: () => document.querySelector('[jsname="tgaKEf"]'),
      extract: extractByJsname,
      strongContainer: true,
    },
    {
      name: 'jsname-DS9Ooe',
      findContainer: () => document.querySelector('[jsname="DS9Ooe"]'),
      extract: extractByJsname,
      strongContainer: true,
    },
    {
      name: 'current-classes',
      findContainer: () => {
        const textEl = document.querySelector('div.ygicle.VbkSUe, div.ygicle');
        return textEl?.closest?.('[jsname="tgaKEf"], [jsname="DS9Ooe"], [role="region"]') ||
          textEl?.closest?.('div.nMcdL.bj4p3b')?.parentElement || null;
      },
      extract: extractByCurrentClasses,
      strongContainer: false,
    },
    {
      name: 'caption-region',
      findContainer: () => [...document.querySelectorAll(CAPTION_REGION_SELECTOR)].find(el => !isInDialog(el)) || null,
      extract: extractByPosition,
      strongContainer: false,
    },
    {
      name: 'aria-live-structured',
      findContainer: findAriaLiveContainer,
      extract: extractByPosition,
      strongContainer: false,
    },
  ];

  function detectCaptionStrategy() {
    for (const strategy of CAPTION_STRATEGIES) {
      const container = strategy.findContainer();
      if (!container || isInDialog(container)) continue;
      const entries = strategy.extract(container);
      if (entries.length || strategy.strongContainer) return { strategy, container, entries };
    }
    return null;
  }

  function emitMeetCaption(text, isFinal) {
    const clean = cleanCaptionText(text);
    if (!clean || !ipcRenderer) return;
    const key = keyText(clean);
    if (isFinal && key === lastCaptionFinalKey) return;
    if (isFinal) lastCaptionFinalKey = key;
    ipcRenderer.send('meet-caption-message', { text: clean, isFinal: Boolean(isFinal), capturedAt: Date.now() });
  }

  function scheduleCaptionFinal(text) {
    if (captionFinalTimer) clearTimeout(captionFinalTimer);
    const scheduledKey = keyText(text);
    captionFinalTimer = setTimeout(() => {
      captionFinalTimer = null;
      if (scheduledKey && scheduledKey === lastCaptionKey && Date.now() - lastCaptionChangedAt >= 2100) {
        emitMeetCaption(lastCaptionText, true);
      }
    }, 2250);
  }

  function markCaptionReady(strategyName) {
    if (captionReadySent) return;
    captionReadySent = true;
    emitCaptionState('ready', { strategy: strategyName || '' });
  }

  function processCaptionEntries(entries, strategyName) {
    if (!entries?.length) return false;
    const latest = entries[entries.length - 1];
    const text = cleanCaptionText(latest.text, latest.speaker);
    const key = keyText(text);
    if (!key) return false;
    markCaptionReady(strategyName);
    if (key !== lastCaptionKey) {
      lastCaptionKey = key;
      lastCaptionText = text;
      lastCaptionChangedAt = Date.now();
      emitMeetCaption(text, false);
      scheduleCaptionFinal(text);
    }
    return true;
  }

  function scanMeetCaptions() {
    let strategy = captionActiveStrategy;
    let root = captionObservedRoot;
    if (!strategy || !root || !root.isConnected) {
      const match = detectCaptionStrategy();
      if (!match) return false;
      strategy = match.strategy;
      root = match.container;
      attachCaptionObserver(match);
      return processCaptionEntries(match.entries?.length ? match.entries : strategy.extract(root), strategy.name);
    }
    return processCaptionEntries(strategy.extract(root), strategy.name);
  }

  function attachCaptionObserver(existingMatch = null) {
    const match = existingMatch || detectCaptionStrategy();
    if (!match) return false;
    const { strategy, container } = match;
    if (captionObservedRoot === container && captionObserver && captionActiveStrategy === strategy) {
      processCaptionEntries(match.entries?.length ? match.entries : strategy.extract(container), strategy.name);
      return true;
    }
    try { captionObserver?.disconnect(); } catch (_) {}
    captionObservedRoot = container;
    captionActiveStrategy = strategy;
    captionObserver = new MutationObserver(() => {
      if (!captionObservedRoot?.isConnected) {
        try { captionObserver?.disconnect(); } catch (_) {}
        captionObserver = null;
        captionObservedRoot = null;
        captionActiveStrategy = null;
        attachCaptionObserver();
        return;
      }
      processCaptionEntries(strategy.extract(captionObservedRoot), strategy.name);
    });
    captionObserver.observe(container, { childList: true, subtree: true, characterData: true });
    processCaptionEntries(match.entries?.length ? match.entries : strategy.extract(container), strategy.name);
    log('Meet caption observer attached via', strategy.name);
    return true;
  }

  function captionsAppearEnabled() {
    const buttons = [...document.querySelectorAll('button, div[role="button"], span[role="button"]')].filter(visible);
    return buttons.some(el => {
      const pressed = el.getAttribute('aria-pressed');
      const label = normalizeText([
        el.getAttribute('aria-label'), el.getAttribute('data-tooltip'), el.getAttribute('title'), el.innerText
      ].filter(Boolean).join(' '));
      if (pressed === 'true' && /caption|subtitle|untertitel|sous-titre|sottotitoli|subtítulo|legenda|ondertiteling/i.test(label)) return true;
      return /turn off captions|disable captions|hide captions|captions are on/i.test(label);
    });
  }

  function ensureMeetCaptionsEnabled() {
    if (!isInMeeting()) return false;
    if (!captionAdmittedSent) {
      captionAdmittedSent = true;
      emitCaptionState('admitted');
    }

    if (attachCaptionObserver()) return true;
    if (captionsAppearEnabled()) return true;

    const now = Date.now();
    if (now - lastCaptionEnableAttemptAt < 2500) return false;
    lastCaptionEnableAttemptAt = now;
    const clicked = clickMeetButtonByText(['turn on captions', 'enable captions', 'show captions']);
    if (!clicked) {
      try {
        document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', code: 'KeyC', keyCode: 67, which: 67, bubbles: true }));
        document.body.dispatchEvent(new KeyboardEvent('keyup', { key: 'c', code: 'KeyC', keyCode: 67, which: 67, bubbles: true }));
      } catch (_) {}
    }
    return false;
  }

  function installMeetCaptionObserver() {
    if (!ipcRenderer) return;
    const bodyObserver = new MutationObserver(() => {
      if (!isInMeeting()) return;
      ensureMeetCaptionsEnabled();
      scanMeetCaptions();
    });
    if (document.body) bodyObserver.observe(document.body, { childList: true, subtree: true });
    setInterval(() => {
      if (!isInMeeting()) return;
      ensureMeetCaptionsEnabled();
      if (!captionObservedRoot?.isConnected) {
        try { captionObserver?.disconnect(); } catch (_) {}
        captionObserver = null;
        captionObservedRoot = null;
        captionActiveStrategy = null;
      }
      attachCaptionObserver();
      scanMeetCaptions();
    }, 750);
    log('Meet local caption observer installed (multi-strategy caption-block path)');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installMeetCaptionObserver, { once: true });
  } else {
    installMeetCaptionObserver();
  }

  async function ensureChatPanelOpen() {
    if (findMeetChatRoot()) return true;
    if (!isInMeeting()) return false;
    const now = Date.now();
    if (now - lastOpenChatAttemptAt < 2200) return false;
    lastOpenChatAttemptAt = now;
    clickMeetButtonByText(['chat with everyone', 'in-call messages', 'open chat', 'show chat']);
    await new Promise(r => setTimeout(r, 600));
    if (findMeetChatRoot()) return true;
    clickMeetButtonByText(['meeting tools', 'activities']);
    await new Promise(r => setTimeout(r, 350));
    clickMeetButtonByText(['chat with everyone', 'in-call messages', 'open chat', 'show chat', 'chat']);
    await new Promise(r => setTimeout(r, 800));
    return !!findMeetChatRoot();
  }

  function senderFromAttributes(el) {
    if (!el || !el.getAttribute) return '';
    let node = el;
    for (let depth = 0; node && depth < 8; depth += 1, node = node.parentElement) {
      const attrs = [
        node.getAttribute('data-sender-name'),
        node.getAttribute('data-author-name'),
        node.getAttribute('data-participant-name'),
        node.getAttribute('aria-label'),
        node.getAttribute('title')
      ].map(normalizeText).filter(Boolean);
      for (const attr of attrs) {
        const m = attr.match(/(?:message\s+from|from|by)\s+([^:,]+)[:,]?/i) || attr.match(/^([^:,]{2,80})\s+(?:said|sent|wrote)/i);
        const sender = normalizeSender(m && m[1]);
        if (sender) return sender;
      }
    }
    return '';
  }

  function normalizeSender(value) {
    const t = cleanChatLine(value, false);
    if (!t || t.length > 80) return '';
    if (isSelfText(t) || isMeetNoise(t) || isClockText(t)) return '';
    if (/^(host|unknown|sent|sending|message sent|could not send message|keep)$/i.test(t)) return '';
    return t;
  }

  function looksLikeName(value) {
    const t = normalizeSender(value);
    if (!t) return false;
    if (isRecentLocalOutgoing(t)) return false;
    if (/[.!?]$/.test(t)) return false;
    const words = t.split(/\s+/).filter(Boolean);
    if (words.length > 5 || t.length > 60) return false;
    return /^[A-Za-z0-9][A-Za-z0-9.'_-]*(\s+[A-Za-z0-9][A-Za-z0-9.'_-]*){0,4}$/.test(t) || /@/.test(t);
  }

  function shouldSkipChatMessage(message, sender) {
    const msg = normalizeText(message);
    if (!msg) return true;
    if (isMeetNoise(msg) || /^(you|me|sent|sending|message sent|could not send message|keep)$/i.test(msg)) return true;
    if (isSelfText(sender)) return true;
    if (isRecentLocalOutgoing(msg)) return true;
    return false;
  }

  function pushRow(rows, occurrence, sender, time, message) {
    const msg = normalizeText(String(message || '').slice(0, 8000));
    let cleanSender = normalizeSender(sender) || 'Host';
    if (shouldSkipChatMessage(msg, cleanSender)) return;
    if (keyText(cleanSender) === keyText(msg)) cleanSender = 'Host';
    const base = `${keyText(cleanSender)}|${normalizeText(time)}|${keyText(msg)}`;
    const ordinal = occurrence.get(base) || 0;
    occurrence.set(base, ordinal + 1);
    rows.push({ sender: cleanSender, time: time || '', message: msg, ordinal });
  }

  function parseCandidateBlock(el) {
    const raw = String(el && [
      el.innerText || el.textContent || '',
      el.getAttribute && el.getAttribute('aria-label') || '',
      el.getAttribute && el.getAttribute('title') || ''
    ].filter(Boolean).join('\n') || '');
    if (!raw || raw.length > 10000) return [];
    const lines = cleanChatLines(raw);
    if (lines.length < 2 || lines.length > 30 || !lines.some(isClockText)) return [];
    if (lines.some(isSelfText)) return [];

    const occurrence = new Map();
    const rows = [];
    const attrSender = senderFromAttributes(el);
    const timeIdxs = lines.map((v, i) => isClockText(v) ? i : -1).filter(i => i >= 0);

    for (let t = 0; t < timeIdxs.length; t += 1) {
      const ti = timeIdxs[t];
      const nextTi = timeIdxs[t + 1] ?? lines.length;
      const time = lines[ti];
      const prev = lines[ti - 1] || '';
      let sender = attrSender || '';
      let messages = [];

      if (!sender && looksLikeName(prev) && ti < lines.length - 1) sender = prev;

      for (let j = ti + 1; j < nextTi; j += 1) {
        const line = lines[j];
        if (!line || isClockText(line)) continue;
        // If a sender is immediately before the next timestamp, do not add that sender line as a message.
        if (j === nextTi - 1 && isClockText(lines[j + 1]) && looksLikeName(line)) continue;
        if (sender && keyText(line) === keyText(sender)) continue;
        messages.push(line);
      }

      // Some Meet builds expose message text before timestamp and no text after timestamp.
      if (!messages.length && prev && !looksLikeName(prev)) messages = [prev];

      // If no reliable sender is exposed, still deliver the message as Host instead of dropping it.
      for (const msg of messages) pushRow(rows, occurrence, sender || 'Host', time, msg);
    }
    return rows;
  }

  function findSmallChatBlocks(root) {
    if (!root) return [];
    const all = [...root.querySelectorAll('[data-message-id], [data-sender-name], [data-author-name], [role="listitem"], [role="article"], li, div')]
      .filter(el => el && visible(el))
      .filter(el => {
        if (el.matches && el.matches('textarea, input, button, [role="button"], [contenteditable="true"], [role="textbox"]')) return false;
        const txt = String(el.innerText || el.textContent || '');
        if (!/\b\d{1,2}:\d{2}(\s?[AP]M)?\b/i.test(txt)) return false;
        if (txt.length > 10000) return false;
        const lines = cleanChatLines(txt);
        if (lines.length < 2) return false;
        const clockCount = lines.filter(isClockText).length;
        const role = normalizeText(el.getAttribute && el.getAttribute('role') || '').toLowerCase();
        const hasMessageAttr = !!(el.getAttribute && (el.getAttribute('data-message-id') || el.getAttribute('data-sender-name') || el.getAttribute('data-author-name')));
        return hasMessageAttr || /listitem|article/.test(role) || (lines.length <= 12 && clockCount <= 2);
      });

    return all.filter(el => !all.some(other => other !== el && el.contains(other)))
      .sort((a, b) => {
        const ra = a.getBoundingClientRect();
        const rb = b.getBoundingClientRect();
        return (ra.top - rb.top) || (ra.left - rb.left);
      })
      .slice(-150);
  }

  function parseRootStream(root) {
    const lines = cleanChatLines(root && (root.innerText || root.textContent) || '');
    const rows = [];
    const occurrence = new Map();
    if (!lines.length || !lines.some(isClockText)) return rows;

    const timeIdxs = lines.map((v, i) => isClockText(v) ? i : -1).filter(i => i >= 0);
    for (let t = 0; t < timeIdxs.length; t += 1) {
      const ti = timeIdxs[t];
      const nextTi = timeIdxs[t + 1] ?? lines.length;
      const time = lines[ti];
      const prev = lines[ti - 1] || '';
      let sender = looksLikeName(prev) && ti < lines.length - 1 ? prev : 'Host';
      if (isSelfText(sender)) continue;
      const messages = [];
      for (let j = ti + 1; j < nextTi; j += 1) {
        const line = lines[j];
        if (!line || isClockText(line)) continue;
        if (j === nextTi - 1 && isClockText(lines[j + 1]) && looksLikeName(line)) continue;
        if (sender && keyText(line) === keyText(sender)) continue;
        messages.push(line);
      }
      if (!messages.length && prev && !looksLikeName(prev)) messages.push(prev);
      for (const msg of messages) pushRow(rows, occurrence, sender, time, msg);
    }
    return rows;
  }

  function emitChatRow(row) {
    if (!ipcRenderer || !row || !row.message) return;
    cleanupChatMemory();
    const key = `${keyText(row.sender || 'Host')}|${normalizeText(row.time || '')}|${keyText(row.message)}|${row.ordinal || 0}`.slice(0, 5000);
    if (seenChatMessages.has(key)) return;
    seenChatMessages.set(key, Date.now());
    ipcRenderer.send('meet-chat-message', {
      sender: row.sender || 'Host',
      message: row.message,
      meetTime: row.time || '',
      chatKey: key,
      timestamp: Date.now()
    });
  }

  function scanChatArea(root) {
    if (!root) return;
    const snapshot = cleanChatLines(root.innerText || root.textContent || '').join('\n');
    if (snapshot && snapshot !== lastIncomingSnapshot) lastIncomingSnapshot = snapshot;

    const rows = [];
    for (const block of findSmallChatBlocks(root)) rows.push(...parseCandidateBlock(block));
    if (!rows.length) rows.push(...parseRootStream(root));
    for (const row of rows) emitChatRow(row);
  }

  function scanAnyVisibleChatBlocks() {
    const candidates = [...document.querySelectorAll('[data-message-id], [data-sender-name], [data-author-name], [role="listitem"], [role="article"], li, div')]
      .filter(el => el && visible(el))
      .filter(el => {
        if (el.matches && el.matches('textarea, input, button, [role="button"], [contenteditable="true"], [role="textbox"]')) return false;
        const txt = normalizeText([
          el.innerText || el.textContent || '',
          el.getAttribute && el.getAttribute('aria-label') || '',
          el.getAttribute && el.getAttribute('title') || ''
        ].filter(Boolean).join(' '));
        if (!/\b\d{1,2}:\d{2}(?:\s?[AP]M)?\b/i.test(txt)) return false;
        if (/ready to join|ask to join|meeting details|people in this call|loading invitees|view everyone in this call/i.test(txt)) return false;
        if (isMeetInactivityPrompt(txt)) return false;
        if (el.closest('[role="alertdialog"]')) return false;
        return txt.length > 4 && txt.length < 12000;
      })
      .filter(el => !isMeetNoise(el.innerText || el.textContent || ''))
      .sort((a, b) => {
        const ra = a.getBoundingClientRect();
        const rb = b.getBoundingClientRect();
        return (ra.top - rb.top) || (ra.left - rb.left);
      })
      .slice(-120);

    const rows = [];
    for (const el of candidates) rows.push(...parseCandidateBlock(el));
    for (const row of rows) emitChatRow(row);
  }

  function scanChatMutation(mutation) {
    const root = findMeetChatRoot();
    if (!root) { scanAnyVisibleChatBlocks(); return; }
    if (mutation && mutation.target && !(mutation.target === root || root.contains(mutation.target) || mutation.target.contains(root))) return;
    scanChatArea(root);
    // Extra fallback handles Meet builds where the visible message node is outside
    // the selected panel ancestor due to portal/shadow-like rendering.
    scanAnyVisibleChatBlocks();
  }

  async function autoSendInitialChatHereOnce() {
    // Workaround for Meet builds where incoming host chat is not exposed until this side
    // has posted at least one chat message. Run only after real meeting admission.
    if (autoChatHereSent) return;
    if (!isInMeeting()) { inMeetingStableSince = 0; return; }

    const now = Date.now();
    if (!inMeetingStableSince) inMeetingStableSince = now;
    if (now - inMeetingStableSince < 2500) return;

    autoChatHereSent = true;
    await ensureChatPanelOpen();
    const result = await sendChatToMeet('chat here').catch(err => ({ success: false, error: err && err.message || String(err) }));
    if (!result || !result.success) {
      autoChatHereSent = false;
      return;
    }
  }

  function installMeetChatObserver() {
    if (chatObserverInstalled || !ipcRenderer || !document.body) return;
    chatObserverInstalled = true;

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) scanChatMutation(mutation);
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });

    setInterval(async () => {
      if (isInMeeting()) await ensureChatPanelOpen();
      const root = findMeetChatRoot();
      if (root) scanChatArea(root);
      scanAnyVisibleChatBlocks();
      await autoSendInitialChatHereOnce();
    }, 700);

    log('Meet chat observer installed v1.2.5 auto-chat-here-after-admission from v1.2.3 base');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installMeetChatObserver, { once: true });
  } else {
    installMeetChatObserver();
  }

  function plainMessageText(value) {
    return normalizeText(String(value || '')).slice(0, 8000);
  }

  function setEditableText(el, text) {
    el.focus();
    try {
      document.execCommand('selectAll', false, null);
      document.execCommand('insertText', false, text);
    } catch (_) {
      el.textContent = text;
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    }
  }

  async function sendChatToMeet(message) {
    const text = plainMessageText(message);
    if (!text) return { success: false, error: 'Empty chat message' };

    let input = findChatInput();
    if (!input) {
      clickMeetButtonByText(['chat with everyone', 'in-call messages', 'show everyone chat', 'open chat']);
      await new Promise(r => setTimeout(r, 650));
      input = findChatInput();
    }
    if (!input) {
      clickMeetButtonByText(['meeting tools', 'activities']);
      await new Promise(r => setTimeout(r, 350));
      clickMeetButtonByText(['chat with everyone', 'in-call messages', 'show everyone chat', 'open chat', 'chat']);
      await new Promise(r => setTimeout(r, 800));
      input = findChatInput();
    }

    if (!input) return { success: false, error: 'Meet chat box not found. Open Meet chat panel once and confirm chat is enabled.' };

    setEditableText(input, text);
    await new Promise(r => setTimeout(r, 220));

    const sent = clickMeetButtonByText(['send a message', 'send message', 'send']);
    if (!sent) {
      try {
        input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter', code: 'Enter', keyCode: 13, which: 13 }));
        input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, cancelable: true, key: 'Enter', code: 'Enter', keyCode: 13, which: 13 }));
      } catch (_) {}
    }

    rememberLocalOutgoing(text);
    return { success: true };
  }

  if (ipcRenderer) {
    ipcRenderer.on('send-meet-chat-text', async (event, message) => {
      const result = await sendChatToMeet(message).catch(err => ({ success: false, error: err.message }));
      ipcRenderer.send('send-meet-chat-result', result);
    });
  }


  // Never keep local mic/camera active.
  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await originalGetUserMedia(constraints);
      stream.getAudioTracks().forEach(t => { t.enabled = false; try { t.stop(); } catch (_) {} });
      stream.getVideoTracks().forEach(t => { t.enabled = false; try { t.stop(); } catch (_) {} });
      return stream;
    };
    log('getUserMedia safety patch installed');
  }

  function ensureAudioGraph() {
    if (audioCtx) return;

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AudioContextClass(); // usually 48000 in Chromium
    mixBus = audioCtx.createGain();
    mixBus.gain.value = 1.0;

    // 512 buffer gives ~10ms chunks at 48kHz. This improves caption latency with a little more CPU.
    processor = audioCtx.createScriptProcessor(512, 1, 1);
    zeroGain = audioCtx.createGain();
    zeroGain.gain.value = 0;

    processor.onaudioprocess = (e) => {
      const input = e.inputBuffer.getChannelData(0);
      const pcm = resampleTo16kPCM(input, audioCtx.sampleRate);
      if (!pcm || !pcm.byteLength) return;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(pcm);
        if (!sentLog) {
          sentLog = true;
          log('Low-latency Meet PCM flowing: sourceRate=', audioCtx.sampleRate, 'targetRate=', TARGET_RATE, 'buffer=512');
        }
      }
    };

    mixBus.connect(processor);
    processor.connect(zeroGain);
    zeroGain.connect(audioCtx.destination); // zero gain, required to keep processor firing
    startedProcessor = true;

    const resume = () => audioCtx.resume().catch(() => {});
    resume();
    document.addEventListener('click', resume, { once: false });
    document.addEventListener('keydown', resume, { once: false });
  }

  // Stateful downsample from 48k-ish float32 to 16k PCM16. Keeps continuity between chunks.
  function resampleTo16kPCM(input, sourceRate) {
    if (!input || input.length === 0) return null;
    if (sourceRate === TARGET_RATE) {
      const out = new Int16Array(input.length);
      for (let i = 0; i < input.length; i++) {
        const s = Math.max(-1, Math.min(1, input[i]));
        out[i] = s < 0 ? s * 32768 : s * 32767;
      }
      return out.buffer;
    }

    const merged = new Float32Array(inputCarry.length + input.length);
    merged.set(inputCarry, 0);
    merged.set(input, inputCarry.length);

    const ratio = sourceRate / TARGET_RATE;
    const outLength = Math.floor(merged.length / ratio);
    if (outLength <= 0) {
      inputCarry = merged;
      return null;
    }

    const out = new Int16Array(outLength);
    for (let i = 0; i < outLength; i++) {
      const idx = i * ratio;
      const i0 = Math.floor(idx);
      const i1 = Math.min(i0 + 1, merged.length - 1);
      const frac = idx - i0;
      const sample = merged[i0] + (merged[i1] - merged[i0]) * frac;
      const s = Math.max(-1, Math.min(1, sample));
      out[i] = s < 0 ? s * 32768 : s * 32767;
    }

    const consumed = Math.floor(outLength * ratio);
    inputCarry = merged.slice(consumed);
    return out.buffer;
  }

  function captureTrack(track) {
    if (!track || track.kind !== 'audio' || capturedTracks.has(track)) return;
    capturedTracks.add(track);
    ensureAudioGraph();

    try {
      const stream = new MediaStream([track]);
      const source = audioCtx.createMediaStreamSource(stream);
      const gain = audioCtx.createGain();
      gain.gain.value = 1.0;
      source.connect(gain);
      gain.connect(mixBus);
      log('Remote audio track added to mixed stream:', track.id || 'audio');

      track.addEventListener('ended', () => {
        try { source.disconnect(); gain.disconnect(); } catch (_) {}
        log('Remote audio track ended:', track.id || 'audio');
      });
    } catch (e) {
      log('Failed to capture audio track:', e.message || e);
    }
  }

  const OrigRTC = window.RTCPeerConnection || window.webkitRTCPeerConnection;
  if (!OrigRTC) return;

  function scanReceivers() {
    for (const pc of peerConnections) {
      try {
        for (const r of pc.getReceivers()) {
          if (r.track && r.track.kind === 'audio') captureTrack(r.track);
        }
      } catch (_) {}
    }
  }

  function PatchedRTC(...args) {
    const pc = new OrigRTC(...args);
    peerConnections.add(pc);

    pc.addEventListener('track', (event) => {
      if (event.track && event.track.kind === 'audio') captureTrack(event.track);
    });

    const origSetRemoteDescription = pc.setRemoteDescription?.bind(pc);
    if (origSetRemoteDescription) {
      pc.setRemoteDescription = async (...srdArgs) => {
        const res = await origSetRemoteDescription(...srdArgs);
        setTimeout(scanReceivers, 100);
        setTimeout(scanReceivers, 800);
        setTimeout(scanReceivers, 2000);
        return res;
      };
    }
    return pc;
  }

  PatchedRTC.prototype = OrigRTC.prototype;
  Object.getOwnPropertyNames(OrigRTC).forEach(k => { try { PatchedRTC[k] = OrigRTC[k]; } catch (_) {} });
  window.RTCPeerConnection = PatchedRTC;
  if (window.webkitRTCPeerConnection) window.webkitRTCPeerConnection = PatchedRTC;

  setInterval(scanReceivers, 700);
  log('RTCPeerConnection patched');
})();
