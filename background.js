importScripts('notes-store.js', 'drive-sync.js', 'tabs-store.js');

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || !message || typeof message.type !== 'string') return;
  const isGmail = sender.tab?.url?.startsWith('https://mail.google.com/');
  const isExtensionPage = sender.url?.startsWith(chrome.runtime.getURL(''));
  if (!isGmail && !isExtensionPage) return;
  let task;
  if (message.type === 'omniclick-tabs-update' && isGmail) task = () => OmniGmailTabsStore.update(message.account, message.operation);
  else if (message.type === 'omniclick-note-put') task = () => OmniNotes.put(message.note);
  else if (message.type === 'omniclick-open-notes' && isGmail) task = () => chrome.tabs.create({ url: chrome.runtime.getURL('notes.html') });
  else if (message.type === 'omniclick-open-drive' && isGmail) task = () => chrome.runtime.openOptionsPage();
  else if (isExtensionPage) {
    const actions = {
      'drive-status': () => OmniDrive.config(), 'drive-connect': () => OmniDrive.connect(),
      'drive-disconnect': () => OmniDrive.disconnect(), 'drive-sync': () => OmniDrive.sync(),
      'drive-history': () => OmniDrive.history(), 'drive-restore': () => OmniDrive.restore(message.fileId),
    };
    task = actions[message.type];
  }
  if (!task) return;
  Promise.resolve().then(task).then((data) => respond({ ok: true, data }))
    .catch((error) => respond({ ok: false, error: String(error?.message || 'Operation failed.').slice(0, 400) }));
  return true;
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && Object.keys(changes).some((key) => key.startsWith(OmniNotes.prefix))) OmniDrive.schedule();
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'omniclick-drive-sync') OmniDrive.sync().catch(() => {});
});
chrome.runtime.onStartup.addListener(() => OmniDrive.init().catch(() => {}));
chrome.runtime.onInstalled.addListener(() => OmniDrive.init().catch(() => {}));
OmniDrive.init().catch(() => {});
