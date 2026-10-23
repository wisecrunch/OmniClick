// Feature registry for content scripts: applies the saved on/off state, and live changes from the popup.
const OmniClick = (() => {
  const features = new Map(); // id -> { impl, on }
  let settings = {};

  function apply(id) {
    const f = features.get(id);
    if (!f) return;
    const want = settings[id] !== false;
    if (want === f.on) return;
    f.on = want;
    try {
      want ? f.impl.enable() : f.impl.disable();
    } catch (err) {
      console.error('[OmniClick]', id, err);
    }
  }

  OmniClickSettings.load().then((s) => {
    settings = s;
    features.forEach((_, id) => apply(id));
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync' || !changes.features) return;
    const next = changes.features.newValue || {};
    OMNICLICK_FEATURES.forEach((f) => { settings[f.id] = OmniClickSettings.enabled(f, next); });
    features.forEach((_, id) => apply(id));
  });

  return {
    register(id, impl) {
      features.set(id, { impl, on: false });
      if (Object.keys(settings).length) apply(id);
    },
  };
})();
