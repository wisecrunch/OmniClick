// Tab recorder controller. The recording itself runs in offscreen.html; this worker starts/stops it,
// shows the REC badge, and keeps the cursor/keystroke overlay injected in the recorded tab.
const FEATURE = 'tab-recorder';
const OVERLAY = 'rec-overlay.js';
const DEFAULT_REC_OPTS = { audio: true, pointer: true, keys: true, mic: false, allSites: false };
const BLOCKED_PAGE = /^(chrome|edge|about|devtools|chrome-extension|chrome-search|view-source):|^https:\/\/(chromewebstore\.google\.com|chrome\.google\.com\/webstore)/i;

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
    // The page can't be scripted (browser pages, or access to this site ended after navigation): record without overlay.
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

const toOffscreen = (type) => chrome.runtime.sendMessage({ target: 'offscreen', type });

async function start(tabId, opts) {
  opts = { ...DEFAULT_REC_OPTS, ...opts };
  if (!(await featureEnabled())) throw new Error('Turn on the Tab recorder in OmniClick first.');
  if (await getState()) throw new Error('A recording is already in progress.');
  const tab = await chrome.tabs.get(tabId);
  if (tab.url && BLOCKED_PAGE.test(tab.url)) {
    throw new Error("Chrome doesn't allow recording this page (browser pages and the Web Store are blocked). Switch to a regular website tab.");
  }
  const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }).catch((e) => {
    throw new Error("Couldn't capture this tab: " + ((e && e.message) || e));
  });
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
  await setState({ tabId, startedAt: Date.now(), opts, rid: res.id, paused: false, pausedMs: 0, pausedSince: 0 });
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
    const res = await toOffscreen('stop');
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

async function setPaused(paused) {
  const rec = await getState();
  if (!rec || rec.paused === paused) return;
  const res = await toOffscreen(paused ? 'pause' : 'resume');
  if (!res || !res.ok) throw new Error((res && res.error) || 'Could not change recording state');
  if (paused) rec.pausedSince = Date.now();
  else { rec.pausedMs += Date.now() - rec.pausedSince; rec.pausedSince = 0; }
  rec.paused = paused;
  await setState(rec);
  chrome.action.setBadgeBackgroundColor({ color: paused ? '#f9ab00' : '#d93025' });
  chrome.action.setBadgeText({ text: paused ? 'II' : 'REC' });
}

const answer = (promise, sendResponse) =>
  promise.then(() => sendResponse({ ok: true }), (e) => sendResponse({ ok: false, error: String((e && e.message) || e) }));

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.target) return; // addressed to the offscreen document
  if (msg.type === 'rec-start') answer(start(msg.tabId, msg.opts), sendResponse);
  else if (msg.type === 'rec-stop') answer(stop(), sendResponse);
  else if (msg.type === 'rec-pause') answer(setPaused(true), sendResponse);
  else if (msg.type === 'rec-resume') answer(setPaused(false), sendResponse);
  else return;
  return true;
});

// Keyboard shortcut (default Alt+Shift+R; change at chrome://extensions/shortcuts). Invoking it grants activeTab.
chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== 'toggle-recording') return;
  try {
    if (await getState()) await stop();
    else {
      const { recOpts } = await chrome.storage.local.get('recOpts');
      await start(tab.id, recOpts);
    }
  } catch (err) {
    chrome.action.setBadgeBackgroundColor({ color: '#d93025' });
    chrome.action.setBadgeText({ text: '!' });
    chrome.action.setTitle({ title: 'OmniClick: ' + ((err && err.message) || err) });
    setTimeout(async () => {
      if (!(await getState())) chrome.action.setBadgeText({ text: '' });
      chrome.action.setTitle({ title: 'OmniClick' });
    }, 6000);
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
