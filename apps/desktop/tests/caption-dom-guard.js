const fs = require('fs');
const path = require('path');
const assert = require('assert');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../meet-controller/meet-preload.js'), 'utf8');
const mainSource = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');

assert(source.includes('[jsname="tgaKEf"]'), 'current Meet jsname caption container must be present');
assert(source.includes('[jsname="YSxPC"]'), 'current Meet speaker block selector must be present');
assert(source.includes('[jsname="r4nke"]'), 'current Meet speaker-name selector must be present');
assert(source.includes('[jsname="bVV8Bd"]'), 'current Meet caption-text selector must be present');
assert(source.includes('div.ygicle.VbkSUe'), 'class-based Meet caption text fallback must be present');
assert(source.includes('div.NWpY1d'), 'current Meet speaker selector must be present');
assert(source.includes('div.nMcdL.bj4p3b'), 'current Meet caption row selector must be present');
assert(source.includes('CAPTION_EXCLUDED_ANCESTOR_SELECTOR'), 'caption extraction must exclude side-panel/control ancestors');
assert(!/fallbackLines\s*=\s*textLines\(root\.innerText/.test(source), 'whole caption-region innerText fallback must never return');
assert(!/textEl\?\.innerText\s*\|\|\s*textEl\?\.textContent\s*\|\|\s*row\.innerText/.test(source), 'caption rows must never fall back to row.innerText');
assert(source.includes("replace(/\\s*arrow_downward\\s*jump to bottom\\s*$/i, '')"), 'material-symbol Jump to bottom suffix must be stripped');
assert(source.includes('markCaptionReady(strategyName);'), 'source should become ready only after validated caption entries exist');
assert(!/cleanCaptionText\(container\.(?:innerText|textContent)/.test(source), 'caption container text must never be emitted as speech');
assert(source.includes('strongContainer: true'), 'known jsname caption containers should be observed even before first speech');
assert(source.includes('caption-text-nodes'), 'leaf text-node strategy must exist for Meet builds where tgaKEf is the text element');
assert(/strongEmpty/.test(source), 'an empty strong container must not shadow strategies that yield captions');
assert(source.includes('isCaptionContinuation'), 'a new utterance must finalize the previous caption line');
assert(source.includes('captionKeyToggleAttempts < 3'), 'the c-key caption toggle must be bounded');
assert(source.includes('CAPTION_STABLE_MS'), 'words must be held until stable so Meet revisions are not shown');
assert(source.includes('function captionDelta'), 'only new words may be emitted so a growing Meet row is not re-printed');

function extractFunction(name) {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  assert(start >= 0, `${name} must exist`);
  let brace = source.indexOf('{', start);
  let depth = 0;
  let i = brace;
  for (; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  return source.slice(start, i + 1);
}

const normalizeText = value => String(value || '')
  .replace(/\u00a0/g, ' ')
  .replace(/[ \t\r\f\v]+/g, ' ')
  .replace(/\s+\n/g, '\n')
  .replace(/\n\s+/g, '\n')
  .trim();
const isCaptionChrome = new Function('normalizeText', `return (${extractFunction('isCaptionChrome')});`)(normalizeText);
const cleanCaptionText = new Function(
  'normalizeText', 'isCaptionChrome', 'cleanCaptionSpeaker', 'isMeetNoise', 'isClockText', 'isMeetAnnouncement',
  `return (${extractFunction('cleanCaptionText')});`
)(normalizeText, isCaptionChrome, () => '', () => false, () => false, () => false);

const renderedCaptionText = new Function('normalizeText', `return (${extractFunction('renderedCaptionText')});`)(normalizeText);
assert.equal(renderedCaptionText({ textContent: 'I wanted Tu Si', innerText: 'I wanted to see' }), 'I wanted to see',
  'PIN participant overlays must read the rendered Meet words, not a hidden alternate');
assert.equal(renderedCaptionText({ textContent: 'I wanted to see' }), 'I wanted to see',
  'rendered text fallback must work for older Meet elements');

// Simulate the participant's real bounded selector against Google's UK option.
const ukSnippet = source.slice(source.indexOf('  const UK_LANGUAGE ='), source.indexOf('  function captionsAppearEnabled()'));
const mockLanguage = { menuOpen: false, selected: false, opens: 0 };
const ukPicker = {
  textContent: 'English (India)', innerText: 'English (India)',
  getAttribute: key => key === 'aria-haspopup' ? 'listbox' : '',
  hasAttribute: key => key === 'aria-expanded',
  click() { mockLanguage.menuOpen = true; mockLanguage.opens++; }
};
const ukOption = {
  innerText: 'English (UK)', textContent: 'English (UK)',
  getAttribute: () => '',
  click() { mockLanguage.selected = true; mockLanguage.menuOpen = false; }
};
const ukContext = vm.createContext({
  Date: class extends Date { static now() { return 100000; } }, normalizeText,
  isInDialog: () => false,
  document: { querySelectorAll: selector => selector.includes('[role="option"]')
    ? (mockLanguage.menuOpen ? [ukOption] : []) : [ukPicker] },
});
vm.runInContext(`${ukSnippet}; this.selectUK = preferUKEnglishCaptions`, ukContext);
ukContext.selectUK();
ukContext.selectUK();
assert.equal(mockLanguage.opens, 1, 'PIN client should open a verified Meet CC-language dropdown only once');
assert.equal(mockLanguage.selected, true, 'PIN client must prefer English UK over English India');
ukContext.selectUK();
assert.equal(mockLanguage.opens, 1, 'successful language selection must not trigger repetitive clicks');

assert.equal(cleanCaptionText('Can can you hear me? arrow_downwardJump to bottom'), 'Can can you hear me?', 'Jump-to-bottom chrome must be removed from a real caption');
assert.equal(cleanCaptionText('arrow_downwardJump to bottom'), '', 'standalone Jump-to-bottom chrome must never become a caption');
assert.equal(cleanCaptionText('We should jump to bottom of the document'), 'We should jump to bottom of the document', 'ordinary spoken words must not be over-filtered');
assert(!mainSource.includes("activateDeepgramFallback('caption DOM not detected')"), 'quiet meetings must not activate Deepgram just because caption DOM is absent');
assert(mainSource.includes('const DEEPGRAM_FALLBACK_ENABLED = false;'), 'desktop Deepgram fallback must remain OFF by default');
assert(mainSource.includes('if (!DEEPGRAM_FALLBACK_ENABLED) return;'), 'audio chunks must never reach Deepgram while disabled');
assert(mainSource.includes('localCaptionAdmitted && !deepgramFallbackActive'), 'fallback must be gated by admitted meeting audio');
assert(mainSource.includes('>= 4000'), 'fallback must require sustained audible speech without captions');

// Caption stream regressions: stable committed words must not be replayed
// when Meet revises a single token, nor when it extends the same utterance.
const captionFns = ['captionWordsOf', 'captionTokenNear', 'captionMostlySame', 'captionDelta', 'isCaptionContinuation'];
const captionContext = vm.createContext({ normalizeText, captionCommitted: [] });
for (const name of captionFns) vm.runInContext(`${extractFunction(name)}; this.${name} = ${name};`, captionContext);
vm.runInContext(`captionCommitted = captionWordsOf('Thank you for joining the call').norm;`, captionContext);
assert.equal(captionContext.captionDelta('Thank u for joining the call'), '', 'one corrected word must not replay full caption');
assert.equal(captionContext.captionDelta('Thank you for joining the call today'), 'today', 'same-row growth should show only new speech');
assert.equal(captionContext.captionDelta('Coming to my roles and responsibilities'), 'Coming to my roles and responsibilities', 'different utterance must survive');
assert.equal(captionContext.captionMostlySame('Great now it is working as expected', 'Great now its working as expected'), true,
  'brief recognizer correction should count as duplicated text');
assert.equal(captionContext.captionMostlySame('Yes', 'Yes'), false, 'short genuine replies must remain visible');
assert.equal(captionContext.isCaptionContinuation('Thank you for joining the call', 'Thank u for joining the call today', '', ''), true);
assert.equal(captionContext.isCaptionContinuation('Thank you for joining the call', 'Coming to my roles and responsibilities', '', ''), false);
assert(source.includes('const CAPTION_STABLE_MS = 200'), 'interim captions should have a short stabilization window');
assert(source.includes('}, 2400)'), 'final captions should allow later Google Meet recognition corrections');
assert(source.includes('function renderedCaptionText'), 'caption extraction must prefer visibly rendered text to raw DOM');
assert(source.includes('preferUKEnglishCaptions()'), 'participant Meet should prefer English UK');

console.log(JSON.stringify({
  ok: true,
  currentJsnameCaptionBlocksRequired: true,
  wholeRegionFallbackRemoved: true,
  sidePanelControlsExcluded: true,
  sourceReadyAfterValidatedCaption: true,
  deepgramFallbackRequiresAudibleFailure: true
}));
