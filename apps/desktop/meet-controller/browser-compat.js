// Keep the Meet UA aligned with the ACTUAL Chromium runtime, not a stale
// Chrome major copied into source. Removes Electron product token only from
// the Meet navigation; it does not change Google's embedded OAuth policy.
function getMeetUserAgent(userAgent, chromiumVersion = process.versions.chrome) {
  const raw = String(userAgent || '').trim();
  const chrome = String(chromiumVersion || '').trim();
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(chrome)) throw new Error('Cannot identify the installed Chromium version.');
  if (Number(chrome.split('.')[0]) < 150) {
    throw new Error('This Zapper desktop build has an outdated Chromium runtime. Rebuild/reinstall the updated Windows app.');
  }
  // Derive the entire UA from the active Electron session, preserving platform.
  // Never retain an old Chrome/124 value that Meet will flag as unsupported.
  if (raw.includes('Mozilla/5.0')) {
    const cleaned = raw.replace(/\bChrome\/\S+/, 'Chrome/' + chrome)
      .replace(/\sElectron\/[^\s]+/g, '')
      .replace(/\sZapper\/[^\s]+/g, '');
    if (/\bChrome\//.test(cleaned)) return cleaned;
  }
  return 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/' + chrome + ' Safari/537.36';
}
module.exports = { getMeetUserAgent };
