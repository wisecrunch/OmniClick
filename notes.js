(() => {
  let active = false, observer, timer, generation = 0, current = null;
  let notes = new Map();
  let loadGeneration = 0;
  let driveState = {};
  function paintCloud(state) {
    let text = 'Drive sync';
    if (driveState.connected && driveState.email === state.note.account) {
      text = driveState.error ? 'Drive: needs attention' : driveState.syncing ? 'Drive: syncing…' :
        state.dirty || state.pending ? 'Drive: queued' : 'Drive connected';
    }
    if (state.cloud.textContent !== text) state.cloud.textContent = text;
  }
  const visible = (node) => node && node.getClientRects().length > 0;
  function account() {
    // Gmail's title includes the active mailbox, including delegated mailboxes.
    const titleEmail = document.title.match(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    if (titleEmail) return titleEmail[0].toLowerCase();
    const profile = document.querySelector('a[href*="accounts.google.com/SignOutOptions"], a[href*="accounts.google.com/SignOut"]');
    const email = profile && `${profile.getAttribute('aria-label') || ''} ${profile.getAttribute('title') || ''}`
      .match(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    return email ? email[0].toLowerCase() : null;
  }
  function routeThread() {
    const parts = location.hash.slice(1).split('/');
    const last = parts.at(-1) || '';
    return parts.length > 1 && /^[\w-]{12,}$/.test(last) ? last : null;
  }
  function elementThread(node) {
    if (!node) return null;
    return node.getAttribute('data-legacy-thread-id') || node.getAttribute('data-thread-perm-id') || node.getAttribute('data-thread-id');
  }
  function threadFor(heading) {
    const region = heading.closest('.if') || heading.closest('[role="main"]');
    const tagged = heading.closest('[data-legacy-thread-id], [data-thread-perm-id], [data-thread-id]');
    const inner = region && [...region.querySelectorAll('[data-legacy-thread-id], [data-thread-perm-id], [data-thread-id]')]
      .find((node) => visible(node) && !node.closest('tr.zA'));
    return elementThread(tagged) || elementThread(inner) || routeThread();
  }
  function create(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  }
  function noteIcon() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(svg.namespaceURI, 'path');
    path.setAttribute('d', 'M8 3h8a3 3 0 0 1 3 3v9l-6 6H8a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3Zm5 18v-4a2 2 0 0 1 2-2h4M9 8h6M9 12h4');
    svg.append(path);
    return svg;
  }
  function setExpanded(state, expanded, focus = false) {
    state.expanded = expanded;
    state.panel.hidden = !expanded;
    state.box.hidden = !expanded;
    state.box.classList.toggle('oc-note-collapsed', !expanded);
    state.launch.setAttribute('aria-expanded', String(expanded));
    state.collapse.setAttribute('aria-expanded', String(expanded));
    const label = expanded ? 'Collapse note' : state.note.text.trim() ? 'Notes' : 'Add note';
    state.launch.setAttribute('aria-label', label);
    state.launch.title = expanded ? 'Hide private note' : state.note.text.trim() ? 'Show private note' : 'Add private note';
    if (expanded && focus) state.textarea.focus();
  }
  function placeLaunch(state, heading) {
    let toolbar = null;
    // Search from this conversation's subject outward, including split-pane Gmail.
    // The .bHJ group is Gmail's print / pop-out toolbar and is language-independent.
    for (let region = heading.parentElement; region && region !== document.body; region = region.parentElement) {
      toolbar = [...region.querySelectorAll('.bHJ')].find(visible);
      if (toolbar || region.getAttribute('role') === 'main') break;
    }
    const header = heading.closest('.ha') || heading.parentElement;
    const host = toolbar || header;
    let reference = toolbar && (toolbar.querySelector('[aria-label="Print all"], [data-tooltip="Print all"], .gK') ||
      toolbar.querySelector('button:not(.oc-note-launch), [role="button"]'));
    const nativeButton = reference;
    while (reference && reference.parentElement !== host) reference = reference.parentElement;
    // Keep the icon as a sibling of Gmail's controls, without copying their listeners.
    if (toolbar) {
      if (state.launch.parentElement !== host || (reference && state.launch.nextSibling !== reference)) {
        host.insertBefore(state.launch, reference || null);
      }
    } else if (state.launch.parentElement !== host) host.append(state.launch);
    state.launch.classList.toggle('oc-note-fallback', !toolbar);
    if (nativeButton) {
      const color = getComputedStyle(nativeButton).color;
      if (state.launch.style.color !== color) state.launch.style.color = color;
    }
  }
  function flush(state) {
    clearTimeout(state.saveTimer);
    if (!state.dirty) return;
    state.dirty = false;
    const revision = ++state.revision;
    ++state.pending;
    state.status.textContent = 'Saving…';
    paintCloud(state);
    const record = { ...state.note, updatedAt: Date.now() };
    state.note = record;
    notes.set(state.key, record);
    OmniNotes.put(record).then(() => {
      if (revision === state.revision && !state.dirty) state.status.textContent = record.text.trim() ? 'Saved in this browser' : 'No note';
    }).catch(() => {
      if (revision !== state.revision) return;
      state.dirty = true;
      state.status.textContent = 'Could not save. Keep this tab open and click Retry.';
      state.retry.hidden = false;
      setExpanded(state, true);
    }).finally(() => { --state.pending; paintCloud(state); });
  }
  function changed(state) {
    state.dirty = true;
    state.status.textContent = 'Unsaved changes';
    paintCloud(state);
    state.retry.hidden = true;
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(() => flush(state), 350);
  }
  function unmount() {
    if (!current) return;
    flush(current);
    current.launch.remove();
    current.box.remove();
    current = null;
  }
  function paint(state) {
    state.box.style.setProperty('--oc-note-color', OmniNotes.colors[state.note.color]);
    state.done.checked = state.note.done;
    state.box.classList.toggle('oc-note-done', state.note.done);
    for (const bubble of state.palette.children) {
      bubble.setAttribute('aria-pressed', String(bubble.dataset.color === state.note.color));
    }
  }
  async function mount(heading, email, thread) {
    const key = OmniNotes.key(email, thread);
    if (current && current.key === key && current.box.isConnected) {
      placeLaunch(current, heading);
      return;
    }
    unmount();
    const token = ++generation;
    let saved;
    try { saved = await OmniNotes.get(email, thread); }
    catch { return; }
    if (!active || token !== generation || !visible(heading) || account() !== email || threadFor(heading) !== thread) return;
    const box = create('section', 'oc-note');
    box.setAttribute('aria-label', 'Private note for this email thread');
    const launch = create('button', 'oc-note-launch'); launch.type = 'button';
    launch.append(noteIcon());
    const panel = create('div', 'oc-note-panel');
    panel.id = `oc-note-panel-${token}`;
    launch.setAttribute('aria-controls', panel.id);
    const bar = create('div', 'oc-note-bar');
    const title = create('strong', 'oc-note-title', 'Private note');
    const status = create('span', 'oc-note-status', saved ? 'Saved in this browser' : 'Only you � saved in this browser');
    status.setAttribute('role', 'status');
    const palette = create('div', 'oc-note-palette');
    palette.setAttribute('role', 'group');
    palette.setAttribute('aria-label', 'Note color');
    for (const [color, value] of Object.entries(OmniNotes.colors)) {
      const bubble = create('button', 'oc-note-color'); bubble.type = 'button';
      bubble.dataset.color = color;
      const label = color[0].toUpperCase() + color.slice(1);
      bubble.setAttribute('aria-label', label);
      bubble.title = label;
      bubble.style.setProperty('--oc-bubble-color', value);
      palette.append(bubble);
    }
    const doneLabel = create('label', 'oc-note-done-label');
    const done = create('input'); done.type = 'checkbox';
    doneLabel.append(done, document.createTextNode(' Done'));
    const collapse = create('button', 'oc-note-collapse', 'Collapse'); collapse.type = 'button';
    collapse.setAttribute('aria-controls', panel.id);
    collapse.setAttribute('aria-expanded', 'true');
    const remove = create('button', 'oc-note-delete', 'Delete'); remove.type = 'button';
    const retry = create('button', '', 'Retry'); retry.type = 'button'; retry.hidden = true;
    const manage = create('button', '', 'All notes'); manage.type = 'button';
    manage.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'omniclick-open-notes' }).catch(() => {
        status.textContent = 'Open notes using the OmniClick toolbar popup.';
      });
    });
    const cloud = create('button', '', 'Drive sync'); cloud.type = 'button';
    cloud.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'omniclick-open-drive' }).catch(() => {
        status.textContent = 'Open Drive sync using the OmniClick toolbar popup.';
      });
    });
    const textarea = create('textarea');
    textarea.id = `oc-note-editor-${token}`;
    textarea.maxLength = 20000; textarea.rows = 3;
    textarea.placeholder = 'Add a private note about this conversation…';
    textarea.setAttribute('aria-label', 'Private note text');
    const note = saved || { version: 1, account: email, thread: OmniNotes.normalizeThread(thread),
      subject: heading.textContent.trim().slice(0, 1000), text: '', color: 'yellow', done: false, updatedAt: Date.now() };
    textarea.value = note.text;
    const state = { key, box, panel, launch, collapse, status, textarea, palette, done, retry, cloud, note, dirty: false, revision: 0, pending: 0 };
    current = state;
    textarea.addEventListener('input', () => { state.note.text = textarea.value; changed(state); });
    textarea.addEventListener('blur', () => flush(state));
    palette.addEventListener('click', (event) => {
      const bubble = event.target.closest('.oc-note-color');
      if (!bubble || !palette.contains(bubble)) return;
      state.note.color = bubble.dataset.color; paint(state); changed(state);
    });
    done.addEventListener('change', () => { state.note.done = done.checked; paint(state); changed(state); });
    retry.addEventListener('click', () => { retry.hidden = true; flush(state); });
    launch.addEventListener('click', (event) => {
      event.preventDefault(); event.stopPropagation();
      if (state.expanded) flush(state);
      setExpanded(state, !state.expanded, !state.expanded);
    });
    launch.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
    });
    collapse.addEventListener('click', () => { flush(state); setExpanded(state, false); launch.focus(); });
    remove.addEventListener('click', () => {
      if (state.note.text && !window.confirm('Delete this private note?')) return;
      textarea.value = ''; state.note.text = ''; state.note.done = false;
      paint(state); changed(state); flush(state);
      setExpanded(state, false); launch.focus();
    });
    const actions = create('div', 'oc-note-actions'); actions.append(palette, doneLabel, collapse);
    const footer = create('div', 'oc-note-footer');
    const links = create('div', 'oc-note-links'); links.append(cloud, manage, remove, retry);
    footer.append(status, links);
    bar.append(title, actions);
    panel.append(bar, textarea, footer);
    box.append(panel);
    // Use the whole conversation header, outside Gmail's narrower subject column.
    const header = heading.closest('.byY') || heading.closest('.ha') || heading;
    header.after(box);
    placeLaunch(state, heading);
    paint(state);
    paintCloud(state);
    setExpanded(state, Boolean(note.text.trim()));
  }
  function decorateRows(email) {
    document.querySelectorAll('tr.zA').forEach((row) => {
      const idNode = row.querySelector('[data-legacy-thread-id], [data-thread-perm-id], [data-thread-id]');
      const thread = elementThread(idNode);
      const note = email && thread ? notes.get(OmniNotes.key(email, thread)) : null;
      let preview = row.querySelector('.oc-note-preview');
      if (!note || !note.text.trim()) { if (preview) preview.remove(); return; }
      const host = row.querySelector('.y6') || row.querySelector('.xY.a4W');
      if (!host) return;
      if (!preview) { preview = create('span', 'oc-note-preview'); host.append(preview); }
      const summary = (note.done ? '✓ ' : 'Note: ') + note.text.replace(/\s+/g, ' ').slice(0, 100);
      if (preview.textContent !== summary) preview.textContent = summary;
      if (preview.title !== note.text) preview.title = note.text;
      const color = OmniNotes.colors[note.color];
      if (preview.dataset.color !== note.color) { preview.style.backgroundColor = color; preview.dataset.color = note.color; }
    });
  }
  function scan() {
    if (!active) return;
    const email = account();
    const heading = [...document.querySelectorAll('h2.hP')].find(visible);
    const thread = heading && threadFor(heading);
    if (heading && email && thread) mount(heading, email, thread);
    else { ++generation; unmount(); }
    decorateRows(email);
  }
  function schedule() {
    if (!active || timer) return;
    timer = setTimeout(() => { timer = null; scan(); }, 150);
  }
  async function reload() {
    const token = ++loadGeneration;
    try {
      const [records, drive] = await Promise.all([OmniNotes.all(), chrome.storage.local.get('omniclick-drive:v1')]);
      if (!active || token !== loadGeneration) return;
      notes = new Map(records.map((n) => [OmniNotes.key(n.account, n.thread), n]));
      driveState = drive['omniclick-drive:v1'] || {};
      if (current) paintCloud(current);
      if (current && !current.dirty && !current.pending && document.activeElement !== current.textarea) {
        const updated = notes.get(current.key);
        const hadText = Boolean(current.note.text.trim());
        if (updated) { current.note = updated; current.textarea.value = updated.text; paint(current); }
        else { current.note.text = ''; current.textarea.value = ''; current.note.done = false; paint(current); }
        const hasText = Boolean(current.note.text.trim());
        setExpanded(current, hadText !== hasText ? hasText : current.expanded);
      }
      schedule();
    } catch (err) { console.error('[OmniClick notes] Could not load notes', err); }
  }
  function storageChanged(changes, area) {
    if (area === 'local' && changes['omniclick-drive:v1']) {
      driveState = changes['omniclick-drive:v1'].newValue || {};
      if (current) paintCloud(current);
    }
    if (area === 'local' && Object.keys(changes).some((k) => k.startsWith(OmniNotes.prefix))) reload();
  }
  const leaving = () => { if (current) flush(current); };
  OmniClick.register('gmail-notes', {
    enable() {
      active = true;
      observer = new MutationObserver(schedule);
      observer.observe(document.body, { childList: true, subtree: true, attributes: true,
        attributeFilter: ['data-legacy-thread-id', 'data-thread-perm-id', 'data-thread-id'] });
      window.addEventListener('hashchange', schedule);
      window.addEventListener('pagehide', leaving);
      chrome.storage.onChanged.addListener(storageChanged);
      reload(); scan();
    },
    disable() {
      active = false; ++generation; ++loadGeneration;
      if (observer) observer.disconnect();
      clearTimeout(timer); timer = null;
      window.removeEventListener('hashchange', schedule);
      window.removeEventListener('pagehide', leaving);
      chrome.storage.onChanged.removeListener(storageChanged);
      unmount();
      document.querySelectorAll('.oc-note-preview').forEach((el) => el.remove());
      notes.clear();
    },
  });
})();
