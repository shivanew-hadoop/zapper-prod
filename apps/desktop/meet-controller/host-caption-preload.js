// Caption-only observer for the host's EXISTING Meet window. Do not import the
// participant preload here: it intentionally disables microphones, whereas the
// host's Meet microphone must remain on. No audio is captured or transmitted.
(() => {
  const { ipcRenderer } = require('electron');
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

  function latestCaption() {
    // Same verified Meet caption selectors as the PIN-participant collector.
    const container = document.querySelector('[jsname="tgaKEf"], [jsname="DS9Ooe"], [role="region"][aria-label*="caption" i]');
    if (!container || excluded(container)) return null;
    const blocks = [...container.querySelectorAll('[jsname="YSxPC"]')];
    if (blocks.length) {
      for (const block of blocks.reverse()) {
        const textEl = block.querySelector('[jsname="bVV8Bd"]');
        if (!textEl || excluded(textEl)) continue;
        const text = clean(textEl.textContent);
        if (text) return { text, speaker: clean(block.querySelector('[jsname="r4nke"]')?.textContent) };
      }
    }
    const rows = [...container.querySelectorAll('div.nMcdL.bj4p3b')];
    for (const row of rows.reverse()) {
      const textEl = row.querySelector('div.ygicle.VbkSUe, div.ygicle');
      if (!textEl || excluded(textEl)) continue;
      const text = clean(textEl.textContent);
      if (text) return { text, speaker: clean(row.querySelector('div.NWpY1d')?.textContent) };
    }
    // Leaf-only fallback; never read an entire Meet panel as spoken text.
    const leaves = [...container.querySelectorAll('[jsname="bVV8Bd"], div.ygicle.VbkSUe, div.ygicle')];
    if (container.matches('[jsname="tgaKEf"]') && !leaves.length && !container.children.length) {
      const text = clean(container.textContent);
      return text ? { text, speaker: '' } : null;
    }
    for (const el of leaves.reverse()) {
      if (excluded(el) || el.querySelector('[jsname="bVV8Bd"], div.ygicle')) continue;
      const text = clean(el.textContent);
      if (text) return { text, speaker: '' };
    }
    return null;
  }

  let lastText = '', lastSpeaker = '', changedAt = 0, lastCommittedText = '';
  let committed = [], stamps = [], shownInterim = '', finalTimer = null;
  let lastFinal = '', lastFinalAt = 0;
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
      if (lastText === text && Date.now() - changedAt >= 1200) commit();
    }, 1300);
  }
  function flushInterim() {
    if (!lastText) return;
    const { words } = wordsOf(lastText);
    let stable = 0;
    while (stable < stamps.length && Date.now() - stamps[stable].at >= 240) stable++;
    const next = delta(words.slice(0, stable).join(' '));
    if (next && next !== shownInterim) { shownInterim = next; emit(next, false); }
  }
  // Use plain English rather than Meet's English (India) beta only when the
  // existing Meet UI exposes an unmistakable caption-language chooser.
  let englishSwitchAttempts = 0, englishMenuAt = 0;
  function preferStandardEnglish() {
    if (englishSwitchAttempts >= 2) return;
    const now = Date.now();
    if (englishMenuAt && now - englishMenuAt < 2500) {
      const plainEnglish = [...document.querySelectorAll('[role="option"], [role="menuitemradio"], [role="menuitem"]')]
        .find(el => textOf(el.textContent) === 'English' && !el.closest?.('[role="dialog"], [role="alertdialog"]'));
      if (plainEnglish) {
        try { plainEnglish.click(); englishSwitchAttempts = 2; } catch (_) {}
      }
      return;
    }
    if (englishMenuAt) englishMenuAt = 0;
    const picker = [...document.querySelectorAll('button, [role="combobox"], [role="button"]')]
      .find(el => /English\s*\(India\)/i.test(textOf([el.getAttribute('aria-label'), el.getAttribute('data-tooltip'), el.textContent].filter(Boolean).join(' '))) &&
        (el.getAttribute('aria-haspopup') || el.getAttribute('aria-expanded') !== null || el.getAttribute('role') === 'combobox'));
    if (!picker) return;
    englishSwitchAttempts++;
    englishMenuAt = now;
    try { picker.click(); } catch (_) {}
  }

  let lastEnableAt = 0;
  function ensureCaptions() {
    if (!inCall()) return;
    preferStandardEnglish(); // Check a newly opened language menu without delay.
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
      if (!inCall()) return;
      ensureCaptions();
      update(latestCaption());
      flushInterim();
    }, 120);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
