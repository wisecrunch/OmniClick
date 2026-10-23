// Feature list shared by the content scripts and the popup. To add a feature: add an entry
// here, then call OmniClick.register(id, { enable, disable }) from a content script.
const OMNICLICK_FEATURES = [
  {
    id: 'gmail-notes',
    name: 'Private Gmail notes',
    description: 'Private thread notes with autosave, colors and inbox previews. Optional Google Drive sync.',
    site: 'mail.google.com',
    defaultEnabled: false,
  },
  {
    id: 'gmail-audio',
    name: 'Gmail audio player',
    description: 'Play .mp3 and .wav attachments (including GSM phone recordings) in Gmail without downloading.',
    site: 'mail.google.com',
  },
];

const OmniClickSettings = {
  enabled(feature, saved) {
    return saved[feature.id] ?? (feature.defaultEnabled !== false);
  },
  async load() {
    const { features = {} } = await chrome.storage.sync.get('features');
    return Object.fromEntries(OMNICLICK_FEATURES.map((f) => [f.id, this.enabled(f, features)]));
  },
  async set(id, enabled) {
    const { features = {} } = await chrome.storage.sync.get('features');
    features[id] = enabled;
    await chrome.storage.sync.set({ features });
  },
};
