// One-time onboarding for the locally installed Zapper Meet host companion.
// A website may initiate a ZIP download; it cannot install/enable an extension.
export const HOST_EXTENSION_ZIP = '/downloads/Zapper-Host-Meet-Chrome-Edge-Extension.zip';
export const HOST_EXTENSION_PENDING_KEY = 'zapperMeetHostExtensionResume-v1';
export const HOST_EXTENSION_DOWNLOADED_KEY = 'zapperMeetHostExtensionDownloaded-v1';

export function supportedHostBrowser(ua = '') {
  const value = String(ua);
  return /(Edg\/|Chrome\/|Chromium\/)/.test(value) && !/(Android|iPhone|iPad|iPod|CriOS|EdgiOS|FxiOS)/i.test(value);
}

export function shouldAutoDownload(storage) {
  return storage.getItem(HOST_EXTENSION_DOWNLOADED_KEY) !== 'yes';
}

export function queueResume(storage, ownerId) { storage.setItem(HOST_EXTENSION_PENDING_KEY, String(ownerId)); }
export function consumeResume(storage, ownerId) {
  const pending = storage.getItem(HOST_EXTENSION_PENDING_KEY);
  if (pending === null) return false;
  storage.removeItem(HOST_EXTENSION_PENDING_KEY);
  return pending === String(ownerId);
}

function triggerDownload(doc = document) {
  const link = doc.createElement('a');
  link.href = HOST_EXTENSION_ZIP;
  link.download = 'Zapper-Host-Meet-Chrome-Edge-Extension.zip';
  link.style.display = 'none';
  doc.body.appendChild(link);
  link.click();
  link.remove();
}

// Kept separate from the existing page layout. Only displayed when the
// extension is missing, so returning hosts see the existing UI unchanged.
export function createHostExtensionSetup({
  doc = document, storage = sessionStorage, userAgent = navigator.userAgent,
  onReload = () => location.reload(),
} = {}) {
  let modal = null;
  let lastFocus = null;
  const supported = supportedHostBrowser(userAgent);

  function close() {
    if (!modal) return;
    modal.remove();
    modal = null;
    lastFocus?.focus?.();
    lastFocus = null;
  }

  function open({ autoDownload = true, ownerId } = {}) {
    if (ownerId === undefined || ownerId === null) throw Error('Host account required for extension setup');
    queueResume(storage, ownerId);
    if (!modal) {
      lastFocus = doc.activeElement;
      const backdrop = doc.createElement('div');
      backdrop.id = 'zapperHostExtensionSetup';
      backdrop.setAttribute('role', 'presentation');
      backdrop.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.66);z-index:2147483646;display:flex;align-items:center;justify-content:center;padding:16px;overflow:auto';
      const dialog = doc.createElement('section');
      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-modal', 'true');
      dialog.setAttribute('aria-labelledby', 'zapperExtensionSetupTitle');
      dialog.style.cssText = 'background:#fff;color:#172033;max-width:540px;width:100%;border-radius:14px;padding:24px;box-sizing:border-box;box-shadow:0 12px 54px #0006;font:15px/1.5 system-ui,sans-serif';
      dialog.innerHTML = `
        <h2 id="zapperExtensionSetupTitle" style="margin:0 0 10px;font-size:22px">One-time Google Meet host setup</h2>
        <p style="margin:0 0 12px">To join Google Meet with your computer microphone, Zapper needs its Chrome/Edge extension installed once.</p>
        <div id="zapperExtensionSupportedSteps">
          <ol style="margin:0 0 14px;padding-left:22px">
            <li>Open the downloaded ZIP and <strong>extract</strong> its contents.</li>
            <li>Open <strong>chrome://extensions</strong> (or <strong>edge://extensions</strong>).</li>
            <li>Turn on <strong>Developer mode</strong>, then choose <strong>Load unpacked</strong>.</li>
            <li>Select the extracted <strong>zapper-host-meet-extension</strong> folder containing <strong>manifest.json</strong>.</li>
            <li>Return to Zapper and click <strong>I've installed it — Continue</strong>.</li>
          </ol>
          <p id="zapperExtensionSetupNotice" role="status" style="font-size:13px;margin:0 0 14px;color:#555">Chrome/Edge will ask for your approval. Installation cannot run silently.</p>
        </div>
        <p id="zapperExtensionUnsupported" hidden>This automatic host flow requires desktop Chrome or Edge. Mobile and Safari cannot install this extension.</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          <button type="button" id="zapperExtensionDownload" style="cursor:pointer;border:1px solid #777;border-radius:7px;padding:9px 12px;background:white;color:#172033">Download extension ZIP</button>
          <button type="button" id="zapperExtensionContinue" style="cursor:pointer;border:0;border-radius:7px;padding:9px 12px;background:#164bda;color:white;font-weight:600">I've installed it — Continue</button>
          <button type="button" id="zapperExtensionCancel" style="cursor:pointer;border:0;border-radius:7px;padding:9px 12px;background:#e8e8e8;color:#172033">Cancel</button>
        </div>`;
      backdrop.appendChild(dialog);
      doc.body.appendChild(backdrop);
      modal = backdrop;
      dialog.addEventListener('keydown', event => {
        if (event.key === 'Escape') { event.preventDefault(); storage.removeItem(HOST_EXTENSION_PENDING_KEY); close(); }
        if (event.key !== 'Tab') return;
        const controls = [...dialog.querySelectorAll('button:not([disabled])')];
        const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && doc.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && doc.activeElement === last) { event.preventDefault(); first.focus(); }
      });
      dialog.querySelector('#zapperExtensionDownload').onclick = () => {
        storage.setItem(HOST_EXTENSION_DOWNLOADED_KEY, 'yes');
        triggerDownload(doc);
      };
      dialog.querySelector('#zapperExtensionContinue').onclick = () => {
        // Chrome doesn't retroactively run installed content scripts in an open
        // Zapper tab. Reload first, then auto-resume Create Session after login.
        close();
        onReload();
      };
      dialog.querySelector('#zapperExtensionCancel').onclick = () => {
        storage.removeItem(HOST_EXTENSION_PENDING_KEY);
        close();
      };
      if (!supported) {
        dialog.querySelector('#zapperExtensionSupportedSteps').hidden = true;
        dialog.querySelector('#zapperExtensionDownload').hidden = true;
        dialog.querySelector('#zapperExtensionContinue').hidden = true;
        dialog.querySelector('#zapperExtensionUnsupported').hidden = false;
      }
      dialog.querySelector('#zapperExtensionCancel').focus();
    }
    if (supported && autoDownload && shouldAutoDownload(storage)) {
      storage.setItem(HOST_EXTENSION_DOWNLOADED_KEY, 'yes');
      triggerDownload(doc);
      modal.querySelector('#zapperExtensionSetupNotice').textContent =
        'Zapper requested the ZIP download. If your browser blocked it, click Download extension ZIP.';
    }
  }
  return { open, close, supported };
}
