const fs = require('fs');
const path = require('path');
const assert = require('assert');
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
assert(/CAPTION_STABLE_MS\s*=\s*(\d+)/.test(source) && Number(source.match(/CAPTION_STABLE_MS\s*=\s*(\d+)/)[1]) <= 400, 'word-stability hold must stay small to keep captions low-latency');
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

assert.equal(cleanCaptionText('Can can you hear me? arrow_downwardJump to bottom'), 'Can can you hear me?', 'Jump-to-bottom chrome must be removed from a real caption');
assert.equal(cleanCaptionText('arrow_downwardJump to bottom'), '', 'standalone Jump-to-bottom chrome must never become a caption');
assert.equal(cleanCaptionText('We should jump to bottom of the document'), 'We should jump to bottom of the document', 'ordinary spoken words must not be over-filtered');
assert(!mainSource.includes("activateDeepgramFallback('caption DOM not detected')"), 'quiet meetings must not activate Deepgram just because caption DOM is absent');
assert(mainSource.includes('localCaptionAdmitted && !deepgramFallbackActive'), 'fallback must be gated by admitted meeting audio');
assert(mainSource.includes('>= 10000'), 'fallback must wait for sustained audible speech without captions');

console.log(JSON.stringify({
  ok: true,
  currentJsnameCaptionBlocksRequired: true,
  wholeRegionFallbackRemoved: true,
  sidePanelControlsExcluded: true,
  sourceReadyAfterValidatedCaption: true,
  deepgramFallbackRequiresAudibleFailure: true
}));

// v4.3.5 guards
{
  const fsx = require('fs'), px = require('path');
  const pre = fsx.readFileSync(px.join(__dirname, '../meet-controller/meet-preload.js'), 'utf8');
  assert(/CAPTION_STABLE_MS = 0\b/.test(pre), 'captions must show instantly (4.3.1 speed)');
  assert(pre.includes('scanMessageIdBlocks') && pre.includes('ensureIndianEnglishCaptions'), 'chat must prefer real message nodes; Indian English attempt present');
  const html = fsx.readFileSync(px.join(__dirname, '../overlay/index.html'), 'utf8');
  assert(!html.includes('id="transcriptionSource"'), 'Source label must not be displayed');
  const mainSrc = fsx.readFileSync(px.join(__dirname, '../main.js'), 'utf8');
  assert(mainSrc.includes('opts.keepRunning'), 'X hides while running');
  console.log(JSON.stringify({ ok: true, v435Guards: true }));
}
