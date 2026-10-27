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

  // Meet can keep alternate/hidden caption text in the same DOM node. Prefer
  // the text actually rendered in the Meet tray over raw DOM textContent.
  function renderedCaptionText(el) {
    if (!el) return '';
    const shown = typeof el.innerText === 'string' ? textOf(el.innerText) : '';
    return shown || textOf(el.textContent || '');
  }

  function latestCaption() {
    // Same verified Meet caption selectors as the PIN-participant collector.
    const container = document.querySelector('[jsname="tgaKEf"], [jsname="DS9Ooe"], [role="region"][aria-label*="caption" i]');
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
  function protectHostFromEmptyCallExit() {
    if (!inCall()) return;
    const now = Date.now();
    const interactive = [...document.querySelectorAll('button,[role="button"],[role="menuitem"],[role="tab"]')]
      .filter(emptyCallVisible);

    // If Google's own reminder appears before Zapper's 12-minute host choice,
    // keep this host-initiated session connected until the Zapper host decides.
    // This is an emergency fallback, not a substitute for the 12+2 minute flow.
    if (now - emptyCallLastPromptAt > 2500) {
      const dialog = [...document.querySelectorAll('[role="dialog"],[role="alertdialog"]')]
        .find(el => /are you still there/i.test(emptyCallLabel(el)) &&
          /only one|only participant|you.re the only one|no one else/i.test(emptyCallLabel(el)));
      if (dialog) {
        const stay = interactive.find(el => dialog.contains?.(el) &&
          /^(?:stay in the call|keep waiting|stay)$/i.test(emptyCallLabel(el)));
        if (stay) {
          try { stay.click(); emptyCallLastPromptAt = now; } catch (_) {}
        }
      }
    }

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
      if (!inCall()) return;
      ensureCaptions();
      // Leave UK language selection undisturbed on the first few seconds.
      if (!emptyCallJoinAt) emptyCallJoinAt = Date.now();
      if (ukApplied || ukAttempts >= 4 || Date.now() - emptyCallJoinAt > 6000) protectHostFromEmptyCallExit();
      update(latestCaption());
      flushInterim();
    }, 120);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
