// Tab recorder controller. The recording itself runs in offscreen.html; this worker starts/stops it,
// shows the REC badge, and keeps the cursor/keystroke overlay injected in the recorded tab.
const FEATURE = 'tab-recorder';
const OVERLAY = 'rec-overlay.js';

const getState = async () => (await chrome.storage.session.get('rec')).rec || null;
const setState = (rec) => (rec ? chrome.storage.session.set({ rec }) : chrome.storage.session.remove('rec'));

async function featureEnabled() {
  const { features = {} } = await chrome.storage.sync.get('features');
  return features[FEATURE] !== false;
}

async function injectOverlay(tabId, opts) {
  if (!opts.pointer && !opts.keys) return;
  try {
    await chrome.scripting.executeScript({ target: { tabId }, func: (o) => { window.__omniclickRecOpts = o; }, args: [opts] });
    await chrome.scripting.executeScript({ target: { tabId }, files: [OVERLAY] });
  } catch (err) {
    // Page can't be scripted (chrome:// pages, Web Store, or no permission yet): record without overlay.
  }
}

async function removeOverlay(tabId) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, func: () => window.__omniclickRecStop && window.__omniclickRecStop() });
  } catch (err) { /* tab gone or not scriptable */ }
}

async function closeOffscreen() {
  if (await chrome.offscreen.hasDocument()) await chrome.offscreen.closeDocument();
}

async function start(tabId, opts) {
  if (!(await featureEnabled())) throw new Error('Turn on the Tab recorder in OmniClick first.');
  if (await getState()) throw new Error('A recording is already in progress.');
  const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
  if (!(await chrome.offscreen.hasDocument())) {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['USER_MEDIA'],
      justification: 'Record the selected tab with MediaRecorder',
    });
  }
  const res = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'start', streamId, opts });
  if (!res || !res.ok) {
    await closeOffscreen();
    throw new Error((res && res.error) || 'Could not start recording');
  }
  await setState({ tabId, startedAt: Date.now(), opts });
  chrome.action.setBadgeBackgroundColor({ color: '#d93025' });
  chrome.action.setBadgeText({ text: 'REC' });
  await injectOverlay(tabId, opts);
}

let stopping = false;
async function stop() {
  const rec = await getState();
  if (!rec || stopping) return;
  stopping = true;
  try {
    const res = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'stop' });
    await setState(null);
    chrome.action.setBadgeText({ text: '' });
    await removeOverlay(rec.tabId);
    await closeOffscreen();
    if (res && res.ok && res.id) {
      chrome.tabs.create({ url: chrome.runtime.getURL('recordings.html?id=' + res.id) });
    }
  } finally {
    stopping = false;
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.target) return; // addressed to the offscreen document
  if (msg.type === 'rec-start') {
    start(msg.tabId, msg.opts).then(() => sendResponse({ ok: true }), (e) => sendResponse({ ok: false, error: String((e && e.message) || e) }));
    return true;
  }
  if (msg.type === 'rec-stop') {
    stop().then(() => sendResponse({ ok: true }), (e) => sendResponse({ ok: false, error: String((e && e.message) || e) }));
    return true;
  }
});

// Navigation replaces the page and its overlay, so put it back.
chrome.tabs.onUpdated.addListener(async (tabId, info) => {
  if (info.status !== 'loading' && info.status !== 'complete') return;
  const rec = await getState();
  if (rec && rec.tabId === tabId) injectOverlay(tabId, rec.opts);
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const rec = await getState();
  if (rec && rec.tabId === tabId) stop();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.features && (changes.features.newValue || {})[FEATURE] === false) stop();
});
