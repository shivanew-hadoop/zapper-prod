// Caption-only observer for the host's EXISTING Meet window. Do not import the
// participant preload here: it intentionally disables microphones, whereas the
// host's Meet microphone must remain on. No audio is captured or transmitted.
(() => {
  const { ipcRenderer } = require('electron');
  // Sandbox-safe, self-contained Meet chat parser. Electron sandbox preloads
  // cannot require arbitrary sibling modules; keep this logic in the preload.
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
  const textOf = value => String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  const wordsOf = value => {
    const words = textOf(value).split(' ').filter(Boolean);
    return { words, norm: words.map(w => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')) };
  };
  const near = (a, b) => {
    if (a === b || (a === 'u' && b === 'you') || (b === 'u' && a === 'you')) return true;
    if (!a || !b || Math.max(a.length, b.length) < 4 || Math.abs(a.length - b.length) > 1) return false;
    let i = 0, j = 0, errors = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) { ++i; ++j; continue; }
      if (++errors > 1) return false;
      if (a.length > b.length) ++i;
      else if (b.length > a.length) ++j;
      else { ++i; ++j; }
    }
    return errors + (i < a.length || j < b.length ? 1 : 0) <= 1;
  };
  const noise = /^(captions?|closed captions?|turn (on|off) captions|jump to bottom|arrow_downward|send message|leave call|meeting tools|people|you)$/i;
  const clean = value => {
    const text = textOf(value).replace(/^(?:arrow_downward|arrow downward?)\s*/i, '')
      .replace(/\s*(?:arrow_downward|arrow downward?)\s*jump to bottom$/i, '');
    return text && !noise.test(text) && text.length <= 12000 ? text : '';
  };
  const inCall = () => Boolean(document.querySelector('[aria-label*="Leave call" i], [data-tooltip*="Leave call" i]'));
  const excluded = el => Boolean(el?.closest?.('[role="dialog"], [role="alertdialog"], [role="menu"], [role="toolbar"], button, [role="button"]'));

  // Meet can keep alternate/hidden caption text in the same DOM node. Prefer
  // the text actually rendered in the Meet tray over raw DOM textContent.
  function renderedCaptionText(el) {
    if (!el) return '';
    const shown = typeof el.innerText === 'string' ? textOf(el.innerText) : '';
    return shown || textOf(el.textContent || '');
  }

  function latestCaption() {
    // Same verified Meet caption selectors as the PIN-participant collector.
    const selector = '[jsname="tgaKEf"], [jsname="DS9Ooe"], [role="region"][aria-label*="caption" i]';
    // Google Meet can leave an old caption tray in the DOM after a layout
    // update. Prefer the last *visible* tray instead of the first stale match.
    const candidates = typeof document.querySelectorAll === 'function'
      ? [...document.querySelectorAll(selector)].filter(el => {
          if (!el || excluded(el) || typeof el.querySelectorAll !== 'function') return false;
          const rect = el.getBoundingClientRect?.();
          return !rect || (rect.width > 0 && rect.height > 0);
        }) : [];
    const container = candidates.length ? candidates[candidates.length - 1] : document.querySelector(selector);
    if (!container || excluded(container)) return null;
    const blocks = [...container.querySelectorAll('[jsname="YSxPC"]')];
    if (blocks.length) {
      for (const block of blocks.reverse()) {
        const textEl = block.querySelector('[jsname="bVV8Bd"]');
        if (!textEl || excluded(textEl)) continue;
        const text = clean(renderedCaptionText(textEl));
        if (text) return { text, speaker: clean(block.querySelector('[jsname="r4nke"]')?.textContent) };
      }
    }
    const rows = [...container.querySelectorAll('div.nMcdL.bj4p3b')];
    for (const row of rows.reverse()) {
      const textEl = row.querySelector('div.ygicle.VbkSUe, div.ygicle');
      if (!textEl || excluded(textEl)) continue;
      const text = clean(renderedCaptionText(textEl));
      if (text) return { text, speaker: clean(row.querySelector('div.NWpY1d')?.textContent) };
    }
    // Leaf-only fallback; never read an entire Meet panel as spoken text.
    const leaves = [...container.querySelectorAll('[jsname="bVV8Bd"], div.ygicle.VbkSUe, div.ygicle')];
    if (container.matches('[jsname="tgaKEf"]') && !leaves.length && !container.children.length) {
      const text = clean(renderedCaptionText(container));
      return text ? { text, speaker: '' } : null;
    }
    for (const el of leaves.reverse()) {
      if (excluded(el) || el.querySelector('[jsname="bVV8Bd"], div.ygicle')) continue;
      const text = clean(renderedCaptionText(el));
      if (text) return { text, speaker: '' };
    }
    return null;
  }

  // Observe actual Google Meet chat inside the host's existing Meet window.
  // This never types/sends a bot message or changes the host microphone.
  const observedChatKeys = new Map();
  let lastChatOpenAttempt = 0;
  function chatVisible(el) {
    if (!el) return false;
    const bounds = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return bounds.width > 0 && bounds.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
  }
  function chatInput() {
    const els = [...document.querySelectorAll('textarea, input, [contenteditable="true"], [role="textbox"]')].filter(chatVisible);
    return els.find(el => /send.*message|message.*everyone|message everyone|chat/i.test([
      el.getAttribute('aria-label'), el.getAttribute('placeholder'), el.getAttribute('data-tooltip')
    ].filter(Boolean).join(' ')));
  }
  function hostChatRoot(input) {
    if (!input) return null;
    let node = input;
    let best = null, score = -1;
    for (let i = 0; i < 10 && node && node !== document.body; i++, node = node.parentElement) {
      const rows = node.querySelectorAll('[data-message-id], [data-sender-name], [role="listitem"], [role="article"]');
      const label = textOf(node.getAttribute?.('aria-label') || '');
      const inner = String(node.innerText || '');
      const points = rows.length * 10 + (/in-call messages|chat with everyone/i.test(label) ? 30 : 0) +
        (/\b\d{1,2}:\d{2}\b/.test(inner) ? 20 : 0) - (inner.length > 150000 ? 100 : 0);
      if (points >= score) { best = node; score = points; }
    }
    return best && score >= 20 ? best : null;
  }
  function openHostChat() {
    if (chatInput() || Date.now() - lastChatOpenAttempt < 5000) return;
    // Let Meet's existing UK-caption and empty-call preference flows finish
    // their first settings pass before opening a different sidebar.
    if (!emptyCallDone && emptyCallStartedAt && Date.now() - emptyCallStartedAt < 12000) return;
    lastChatOpenAttempt = Date.now();
    const control = [...document.querySelectorAll('button, [role="button"]')].find(el =>
      chatVisible(el) && /chat with everyone|in-call messages|open chat/i.test([
        el.getAttribute('aria-label'), el.getAttribute('data-tooltip'), el.getAttribute('title')
      ].filter(Boolean).join(' ')));
    try { control?.click(); } catch (_) {}
  }
  function scanHostChat() {
    const input = chatInput();
    if (!input) { openHostChat(); return; }
    const root = hostChatRoot(input);
    if (!root) return;
    // A timestamped caption can look like sender/time/message. Never parse
    // generic <article>/<listitem> nodes or the whole panel as Meet chat.
    const blocks = [...root.querySelectorAll('[data-message-id]')]
      .filter(chatVisible).filter(el => !el.querySelector('[data-message-id]'));
    const now = Date.now();
    for (const [id, at] of observedChatKeys) if (now - at > 3 * 60 * 60 * 1000) observedChatKeys.delete(id);
    for (const block of blocks) {
      const raw = typeof block.innerText === 'string' ? block.innerText : block.textContent;
      const sender = block.getAttribute?.('data-sender-name') || block.getAttribute?.('data-author-name') || '';
      const rows = parseRows(raw, sender);
      // On some Meet builds a real message row has an author + message ID but
      // no visible timestamp. Do not drop it. Never fall back for anonymous
      // UI containers, so Google admin notices cannot become chat messages.
      if (!rows.length && block.getAttribute?.('data-message-id') && name(sender)) {
        const lines = splitLines(raw).filter(line =>
          !isClock(line) && !system(line) && tidy(line) !== tidy(sender));
        const message = tidy(lines.join('\n'));
        if (message && !system(message)) {
          const author = /^(you|me)$/i.test(sender) ? 'Host' : sender;
          rows.push({ sender: author, meetTime: '', message,
            chatKey: `${author.toLowerCase()}|${block.getAttribute('data-message-id')}` });
        }
      }
      for (const row of rows) {
        const key = `${row.chatKey}|${block.getAttribute?.('data-message-id') || ''}`;
        if (observedChatKeys.has(key)) continue;
        observedChatKeys.set(key, now);
        ipcRenderer.send('host-meet-chat-message', row);
      }
    }
  }

  let lastText = '', lastSpeaker = '', changedAt = 0, lastCommittedText = '';
  let committed = [], stamps = [], shownInterim = '', finalTimer = null;
  let lastFinal = '', lastFinalAt = 0;
  // Where do the words that were NOT yet committed begin in `norm`? Meet may
  // revise or insert a word in the middle of a row that is already committed;
  // a plain "same first N words" test then fails and the WHOLE row (all earlier
  // sentences) was printed again. This aligns the committed words against the
  // new row (longest common subsequence, tolerant of one-letter edits) and
  // treats unmatched trailing committed words as in-place revisions.
  // Returns -1 when the row is genuinely unrelated (a new utterance).
  function committedEnd(done, norm) {
    const c = Math.min(done.length, 250);
    const C = done.slice(done.length - c);
    const n = Math.min(norm.length, c + 40);
    if (c < 3 || n < 3) return -1;
    const w = n + 1, table = new Uint16Array((c + 1) * w);
    for (let i = 1; i <= c; i++) for (let j = 1; j <= n; j++) {
      table[i * w + j] = near(C[i - 1], norm[j - 1]) ? table[(i - 1) * w + j - 1] + 1
        : Math.max(table[(i - 1) * w + j], table[i * w + j - 1]);
    }
    let i = c, j = n, matches = 0, firstA = -1, firstB = -1, lastA = -1, lastB = -1;
    while (i > 0 && j > 0) {
      if (near(C[i - 1], norm[j - 1]) && table[i * w + j] === table[(i - 1) * w + j - 1] + 1) {
        if (lastB < 0) { lastA = i - 1; lastB = j - 1; }
        firstA = i - 1; firstB = j - 1; matches++; i--; j--;
      } else if (table[(i - 1) * w + j] >= table[i * w + j - 1]) i--;
      else j--;
    }
    if (matches < 2 || firstB > 3) return -1;
    if (matches < 0.6 * (lastB - firstB + 1) || matches < 0.6 * (c - firstA)) return -1;
    return Math.min(norm.length, lastB + 1 + (c - 1 - lastA));
  }
  function delta(value) {
    const { words, norm } = wordsOf(value);
    if (!committed.length) return value;
    let matched = 0;
    while (matched < Math.min(committed.length, norm.length) && near(committed[matched], norm[matched])) matched++;
    if (matched >= Math.max(1, Math.ceil(Math.min(committed.length, norm.length) * .8))) {
      return norm.length <= committed.length ? '' : words.slice(committed.length).join(' ');
    }
    for (let size = Math.min(committed.length, norm.length); size >= 2; size--) {
      if (norm.slice(0, size).every((word, i) => near(committed[committed.length - size + i], word))) {
        return words.slice(size).join(' ');
      }
    }
    const aligned = committedEnd(committed, norm);
    if (aligned >= 0) return aligned >= norm.length ? '' : words.slice(aligned).join(' ');
    return value;
  }
  function continuation(before, after, oldSpeaker, speaker) {
    if (oldSpeaker && speaker && oldSpeaker.toLowerCase() !== speaker.toLowerCase()) return false;
    const a = wordsOf(before).norm, b = wordsOf(after).norm;
    if (!a.length || !b.length) return true;
    let prefix = 0;
    while (prefix < Math.min(a.length, b.length) && near(a[prefix], b[prefix])) prefix++;
    if (prefix >= Math.max(1, Math.ceil(Math.min(a.length, b.length) * .6))) return true;
    for (let size = Math.min(a.length, b.length); size >= 2; size--) {
      if (a.slice(-size).every((word, i) => near(word, b[i]))) return true;
    }
    // Same row with a word revised/inserted in the middle: still one utterance.
    if (committedEnd(a, b) >= 0) return true;
    return false;
  }
  function emit(value, isFinal) {
    const text = clean(value);
    if (!text) return;
    if (isFinal) {
      const key = wordsOf(text).norm.join(' ');
      if (key === lastFinal && Date.now() - lastFinalAt < 3500) return;
      lastFinal = key;
      lastFinalAt = Date.now();
    }
    ipcRenderer.send('host-caption-message', { text, isFinal, capturedAt: Date.now() });
  }
  function commit() {
    if (!lastText) return;
    const suffix = delta(lastText);
    if (suffix) emit(suffix, true);
    lastCommittedText = lastText;
    committed = wordsOf(lastText).norm;
    shownInterim = '';
  }
  function update(next) {
    const text = clean(next?.text);
    if (!text || text === lastText) return;
    if (lastText && !continuation(lastText, text, lastSpeaker, next.speaker)) {
      commit();
      committed = [];
      stamps = [];
    }
    const now = Date.now();
    const previous = stamps;
    const { norm } = wordsOf(text);
    let overlap = 0;
    for (let size = Math.min(norm.length, previous.length); size >= 2; size--) {
      if (norm.slice(0, size).every((word, i) => near(word, previous[previous.length - size + i].norm))) {
        overlap = size;
        break;
      }
    }
    stamps = norm.map((word, i) => {
      const prev = overlap && i < overlap ? previous[previous.length - overlap + i] : (!overlap ? previous[i] : null);
      return prev && near(prev.norm, word) ? { norm: word, at: prev.at } : { norm: word, at: now };
    });
    lastText = text;
    lastSpeaker = next.speaker || '';
    changedAt = now;
    if (finalTimer) clearTimeout(finalTimer);
    finalTimer = setTimeout(() => {
      if (lastText === text && Date.now() - changedAt >= 2300) commit();
    }, 2400);
  }
  function flushInterim() {
    if (!lastText) return;
    const { words } = wordsOf(lastText);
    let stable = 0;
    while (stable < stamps.length && Date.now() - stamps[stable].at >= 240) stable++;
    const next = delta(words.slice(0, stable).join(' '));
    if (next && next !== shownInterim) { shownInterim = next; emit(next, false); }
  }
  // Prefer Google Meet's English (UK), including its long "United Kingdom"
  // label, only through an identifiable caption-language dropdown.
  const UK_LANGUAGE = /^English\s*\(\s*(?:UK|United Kingdom)\s*\)(?:\s*(?:selected|check|done|✓))?$/i;
  const ENGLISH_LANGUAGE = /^English(?:\s*\([^)]{1,35}\))?(?:\s*\(?beta\)?)?(?:\s*(?:arrow_drop_down|expand_more))?$/i;
  let ukApplied = false, ukMenuOpenedAt = 0, ukAttempts = 0, ukLastAttemptAt = 0;
  function preferUKEnglishCaptions() {
    if (ukApplied) return;
    const now = Date.now();
    if (ukMenuOpenedAt && now - ukMenuOpenedAt < 3000) {
      const option = [...document.querySelectorAll('[role="option"], [role="menuitemradio"], [role="menuitem"], [role="radio"]')]
        .find(el => UK_LANGUAGE.test(textOf(el.innerText || el.textContent || el.getAttribute('aria-label') || '')));
      if (option) {
        try { option.click(); ukApplied = true; } catch (_) {}
      }
      return;
    }
    ukMenuOpenedAt = 0;
    if (ukAttempts >= 4 || now - ukLastAttemptAt < 1800) return;
    const picker = [...document.querySelectorAll('button, [role="combobox"], [role="button"]')].find(el => {
      if (el.closest?.('[role="dialog"], [role="alertdialog"]')) return false;
      const label = textOf([el.getAttribute('aria-label'), el.getAttribute('data-tooltip'), el.getAttribute('title'), el.innerText || el.textContent]
        .filter(Boolean).join(' '));
      const single = textOf(el.innerText || el.textContent || '');
      const isDropdown = el.getAttribute('role') === 'combobox' || el.getAttribute('aria-haspopup') || el.hasAttribute?.('aria-expanded');
      return isDropdown && (ENGLISH_LANGUAGE.test(single) || /caption(?:s)?\s+language|spoken\s+language|language:\s*English/i.test(label));
    });
    if (!picker) return;
    const selected = textOf(picker.innerText || picker.textContent || '');
    if (UK_LANGUAGE.test(selected)) { ukApplied = true; return; }
    ukAttempts++;
    ukLastAttemptAt = now;
    ukMenuOpenedAt = now;
    try { picker.click(); } catch (_) { ukMenuOpenedAt = 0; }
  }

  // Google Meet may end a one-person meeting after 10+2 minutes even if the
  // microphone has captured speech. Handle the Google preference automatically
  // for each fresh host Meet page. Do NOT fabricate audio/captions or alter
  // session ownership. Only act on uniquely identified Google Meet controls.
  let emptyCallStage = 'more', emptyCallDone = false, emptyCallAttempts = 0;
  let emptyCallJoinAt = 0, emptyCallLastAction = 0, emptyCallStartedAt = 0;
  let emptyCallWaitingForVerification = false, emptyCallLastPromptAt = 0;
  const emptyCallLabel = el => textOf(
    el?.getAttribute?.('aria-label') || el?.getAttribute?.('data-tooltip') ||
    el?.getAttribute?.('title') || el?.innerText || el?.textContent
  );
  function emptyCallVisible(el) {
    if (!el) return false;
    try {
      const r = el.getBoundingClientRect();
      return r.width > 1 && r.height > 1;
    } catch (_) { return true; }
  }
  function emptyCallToggleValue(el) {
    if (!el) return null;
    const aria = el.getAttribute?.('aria-checked');
    if (aria === 'true') return true;
    if (aria === 'false') return false;
    const pressed = el.getAttribute?.('aria-pressed');
    if (pressed === 'true') return true;
    if (pressed === 'false') return false;
    const state = el.getAttribute?.('data-state');
    if (state === 'checked' || state === 'on') return true;
    if (state === 'unchecked' || state === 'off') return false;
    if (typeof el.checked === 'boolean') return el.checked;
    return null; // No observable state: never risk switching an OFF control ON.
  }
  function namedEmptyCallToggle() {
    const toggleSelector = '[role="switch"],[role="checkbox"],input[type="checkbox"]';
    const toggles = [...document.querySelectorAll(toggleSelector)].filter(emptyCallVisible);
    const direct = toggles.find(el => /^leave empty calls$/i.test(emptyCallLabel(el)));
    if (direct) return direct;
    // Meet commonly puts the text and checkbox in different children of a row.
    // Require a short, exact label and exactly one switch in the same local row.
    const labels = [...document.querySelectorAll('label,span,div,p')]
      .filter(el => emptyCallVisible(el) && /^leave empty calls$/i.test(textOf(el.innerText || el.textContent)));
    for (const el of labels) {
      if (el.htmlFor && document.getElementById) {
        const linked = document.getElementById(el.htmlFor);
        if (linked && toggles.includes(linked)) return linked;
      }
      let row = el;
      for (let depth = 0; depth < 3 && row; ++depth, row = row.parentElement) {
        const matches = toggles.filter(t => t === row || row.contains?.(t));
        if (matches.length === 1) return matches[0];
      }
    }
    return null;
  }
  // This prompt can cover the Meet leave button, so it must be detected
  // BEFORE the ordinary inCall() check. It is unrelated to microphone speech:
  // Google counts admitted Meet participants, not Zapper PIN listeners.
  function dismissMeetAloneReminder() {
    const now = Date.now();
    if (now - emptyCallLastPromptAt < 2500) return false;
    const interactive = [...document.querySelectorAll('button,[role="button"]')].filter(emptyCallVisible);
    const stayNames = /^(?:stay in (?:the )?call|keep waiting|stay|continue (?:the )?(?:meeting|call))$/i;
    const dialogs = [...document.querySelectorAll('[role="dialog"],[role="alertdialog"]')];
    for (const dialog of dialogs) {
      const content = textOf(dialog.innerText || dialog.textContent || emptyCallLabel(dialog));
      const isAlone = /are you still there|you(?:'re| are) (?:the )?only one|you(?:'re| are) alone|no one else|leave empty call/i.test(content);
      if (!isAlone) continue;
      const stay = interactive.find(el => dialog.contains?.(el) && stayNames.test(emptyCallLabel(el)));
      if (stay) {
        try { stay.click(); emptyCallLastPromptAt = now; return true; } catch (_) {}
      }
    }
    // Some Meet revisions render the notification as a floating panel without
    // role=dialog. Require both a Stay control and a nearby alone-call warning.
    const stay = interactive.find(el => stayNames.test(emptyCallLabel(el)));
    if (stay) {
      let ancestor = stay.parentElement;
      for (let depth = 0; ancestor && depth < 5; depth++, ancestor = ancestor.parentElement) {
        const text = textOf(ancestor.innerText || ancestor.textContent || '');
        if (/are you still there|you(?:'re| are) (?:the )?only one|you(?:'re| are) alone|no one else/i.test(text)) {
          try { stay.click(); emptyCallLastPromptAt = now; return true; } catch (_) {}
        }
      }
    }
    return false;
  }
  function protectHostFromEmptyCallExit() {
    if (!inCall()) return;
    const now = Date.now();
    const interactive = [...document.querySelectorAll('button,[role="button"],[role="menuitem"],[role="tab"]')]
      .filter(emptyCallVisible);

    if (emptyCallDone) return;
    if (!emptyCallStartedAt) emptyCallStartedAt = now;
    // Several tries over 90 seconds, rather than silently assuming the first
    // click worked. A new Meet navigation resets all page-local state.
    if (now - emptyCallStartedAt > 90000 || emptyCallAttempts > 18 || now - emptyCallLastAction < 1200) return;
    const click = el => {
      if (!el) return false;
      try { el.click(); emptyCallLastAction = now; emptyCallAttempts++; return true; }
      catch (_) { return false; }
    };
    const toggle = namedEmptyCallToggle();
    if (toggle) {
      const enabled = emptyCallToggleValue(toggle);
      if (enabled === false) {
        emptyCallDone = true; // Confirmed OFF by Meet's rendered switch state.
        emptyCallWaitingForVerification = false;
        const close = interactive.find(el => /^(?:close settings|close)$/i.test(emptyCallLabel(el)));
        if (close) try { close.click(); } catch (_) {}
      } else if (enabled === true && !emptyCallWaitingForVerification) {
        if (click(toggle)) emptyCallWaitingForVerification = true;
      } else if (enabled === true && emptyCallWaitingForVerification && now - emptyCallLastAction > 4500) {
        // The control still reports ON. Retry with a fresh click, then verify.
        emptyCallWaitingForVerification = false;
      }
      return;
    }
    if (emptyCallWaitingForVerification && now - emptyCallLastAction > 4500) {
      // The setting disappeared after clicking; reopen and verify, not assume.
      emptyCallWaitingForVerification = false;
      emptyCallStage = 'more';
    }
    if (emptyCallStage === 'more') {
      const more = interactive.find(el => /^(?:more options|more actions)$/i.test(emptyCallLabel(el)));
      if (click(more)) emptyCallStage = 'settings';
    } else if (emptyCallStage === 'settings') {
      const settings = interactive.find(el => /^settings$/i.test(emptyCallLabel(el)));
      if (click(settings)) emptyCallStage = 'general';
      else if (now - emptyCallLastAction > 4500) emptyCallStage = 'more';
    } else if (emptyCallStage === 'general') {
      const general = interactive.find(el => /^general$/i.test(emptyCallLabel(el)));
      if (click(general)) emptyCallStage = 'toggle';
      else if (now - emptyCallLastAction > 4500) emptyCallStage = 'more';
    } else if (emptyCallStage === 'toggle' && now - emptyCallLastAction > 6000) {
      emptyCallStage = 'more';
    }
  }

  let lastEnableAt = 0;
  function ensureCaptions() {
    if (!inCall()) return;
    preferUKEnglishCaptions(); // Check a newly opened language menu without delay.
    if (Date.now() - lastEnableAt < 2500) return;
    lastEnableAt = Date.now();
    const buttons = [...document.querySelectorAll('button, [role="button"]')];
    const label = el => textOf([el.getAttribute('aria-label'), el.getAttribute('data-tooltip'), el.getAttribute('title')].filter(Boolean).join(' ')).toLowerCase();
    if (buttons.some(button => /turn off captions|disable captions|hide captions/.test(label(button)))) return;
    const off = buttons.find(button => /turn on captions|enable captions|show captions/.test(label(button)));
    if (off) try { off.click(); } catch (_) {}
  }
  function start() {
    setInterval(() => {
      dismissMeetAloneReminder(); // also works when the modal hides the leave button
      if (!inCall()) return;
      ensureCaptions();
      // Leave UK language selection undisturbed on the first few seconds.
      if (!emptyCallJoinAt) emptyCallJoinAt = Date.now();
      if (ukApplied || ukAttempts >= 4 || Date.now() - emptyCallJoinAt > 6000) protectHostFromEmptyCallExit();
      update(latestCaption());
      flushInterim();
    }, 120);
    setInterval(() => { if (inCall()) scanHostChat(); }, 650);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
