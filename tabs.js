(() => {
  const Store = OmniGmailTabsStore;
  let enabled = false, observer, timer, bar, list, status, mailbox = '', tabs = [], dialog;
  let generation = 0, signature = '', dragging = null;
  const visible = node => node && node.getClientRects().length > 0;
  function account() {
    const pattern = /[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
    const match = document.title.match(pattern);
    if (match) return match[0].toLowerCase();
    const profile = document.querySelector('a[href*="accounts.google.com/SignOut"]');
    return (profile?.getAttribute('aria-label')?.match(pattern)?.[0] || '').toLowerCase();
  }
  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const decode = text => { try { return decodeURIComponent(text.replace(/\+/g, ' ')); } catch { return text; } };
  function labels() {
    const found = new Set();
    // Gmail exposes label routes even when the label name is visually truncated.
    document.querySelectorAll('a[href*="#label/"]').forEach(link => {
      if (link.closest('.oc-tabs')) return;
      const value = link.getAttribute('href').split('#label/')[1];
      if (value) found.add(decode(value));
    });
    return [...found].sort((a, b) => a.localeCompare(b));
  }
  function query(tab) {
    if (tab.kind !== 'label') return tab.value;
    const names = [tab.value];
    if (tab.includeChildren) names.push(...(tab.children || []), ...labels().filter(name => name.startsWith(tab.value + '/')));
    return '{' + [...new Set(names)].map(name => 'label:"' + name.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"').join(' ') + '}';
  }
  function href(tab) {
    if (tab.kind === 'inbox') return '#inbox';
    if (tab.kind === 'label' && !tab.includeChildren) return '#label/' + encodeURIComponent(tab.value);
    return '#search/' + encodeURIComponent(query(tab));
  }
  function currentView() {
    const [route, value = ''] = location.hash.slice(1).split('/');
    if (route === 'search' && value) return { kind: 'search', value: decode(value), name: decode(value).slice(0, 80) };
    if (route === 'label' && value) return { kind: 'label', value: decode(value), name: decode(value).slice(0, 80) };
    if (route === 'inbox') return { kind: 'inbox', value: '', name: 'Inbox' };
    const builtins = { starred: 'is:starred', sent: 'in:sent', drafts: 'in:drafts', all: 'in:anywhere -in:spam -in:trash',
      important: 'is:important', snoozed: 'in:snoozed', spam: 'in:spam', trash: 'in:trash' };
    return builtins[route] ? { kind: 'search', value: builtins[route], name: route[0].toUpperCase() + route.slice(1) } : null;
  }
  function tell(message) { if (status) status.textContent = message; }
  async function change(operation, email = mailbox) {
    const result = await Store.update(email, operation);
    if (enabled && mailbox === email) { tabs = result; signature = ''; render(); }
  }
  function move(id, direction) {
    const index = tabs.findIndex(t => t.id === id);
    const next = index + direction;
    if (next < 0 || next >= tabs.length) return;
    const before = direction < 0 ? tabs[next].id : tabs[next + 1]?.id || '';
    change({ type: 'move', id, before }).then(() => {
      [...list.querySelectorAll('.oc-tabs-link')].find(a => a.dataset.id === id)?.focus();
    }).catch(error => tell(error.message));
  }
  function render() {
    if (!bar) return;
    const nextSignature = JSON.stringify(tabs) + location.hash + JSON.stringify(labels());
    if (signature === nextSignature) return;
    signature = nextSignature;
    const nodes = tabs.map(tab => {
      const item = el('div', 'oc-tabs-item'); item.draggable = true;
      item.style.setProperty('--oc-tab-bg', tab.color); item.style.setProperty('--oc-tab-text', tab.textColor);
      const link = el('a', 'oc-tabs-link', tab.name);
      link.href = href(tab); link.dataset.id = tab.id;
      link.title = (tab.kind === 'inbox' ? 'Inbox' : tab.kind === 'label' ? tab.value + (tab.includeChildren ? ' + sublabels' : '') : tab.value) + '\nAlt + Left/Right to reorder';
      const active = location.hash === link.getAttribute('href') || location.hash.startsWith(link.getAttribute('href') + '/');
      if (active) { link.setAttribute('aria-current', 'page'); item.classList.add('oc-tabs-current'); }
      link.addEventListener('keydown', event => {
        if (event.altKey && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
          event.preventDefault(); event.stopPropagation(); move(tab.id, event.key === 'ArrowLeft' ? -1 : 1);
        }
      });
      const edit = button('Edit ' + tab.name, '✎', 'oc-tabs-edit');
      edit.addEventListener('click', () => editTab(tab, edit));
      item.append(link, edit);
      item.addEventListener('dragstart', event => {
        dragging = tab.id; event.dataTransfer.setData('text/plain', tab.id); event.dataTransfer.effectAllowed = 'move';
      });
      item.addEventListener('dragend', () => { dragging = null; item.classList.remove('oc-tabs-drop'); });
      item.addEventListener('dragover', event => { if (dragging && dragging !== tab.id) { event.preventDefault(); item.classList.add('oc-tabs-drop'); } });
      item.addEventListener('dragleave', () => item.classList.remove('oc-tabs-drop'));
      item.addEventListener('drop', event => {
        event.preventDefault(); item.classList.remove('oc-tabs-drop');
        if (dragging) change({ type: 'move', id: dragging, before: tab.id }).catch(error => tell(error.message));
        dragging = null;
      });
      return item;
    });
    if (!nodes.length) nodes.push(el('span', 'oc-tabs-empty', 'Keep your favorite labels and searches here.'));
    list.replaceChildren(...nodes);
    const pin = bar.querySelector('.oc-tabs-pin');
    pin.disabled = !currentView();
  }
  function button(label, text, cls) {
    const node = el('button', cls, text); node.type = 'button'; node.title = label; node.setAttribute('aria-label', label); return node;
  }
  function closeEditor() { if (dialog) { const node = dialog; dialog = null; node.close(); node.remove(); } }
  function editTab(existing, origin, preset = null) {
    closeEditor();
    const email = mailbox;
    const tab = existing || { id: crypto.randomUUID(), name: '', kind: 'search', value: '',
      color: Store.colors.blue, textColor: '#263247', ...preset };
    const modal = el('dialog', 'oc-tabs-dialog'); dialog = modal;
    modal.setAttribute('aria-labelledby', 'oc-tabs-dialog-title');
    const form = el('form');
    const heading = el('h2', '', existing ? 'Edit tab' : 'Add a tab'); heading.id = 'oc-tabs-dialog-title';
    const caption = el('p', 'oc-tabs-caption', email);
    const field = (label, input) => { input.setAttribute('aria-label', label); const wrap = el('label', 'oc-tabs-field'); wrap.append(el('span', '', label), input); return wrap; };
    const name = el('input'); name.required = true; name.maxLength = 80; name.value = tab.name; name.autocomplete = 'off';
    const type = el('select');
    for (const [value, label] of [['search', 'Gmail search'], ['label', 'Gmail label'], ['inbox', 'Inbox']]) {
      const option = el('option', '', label); option.value = value; type.append(option);
    }
    type.value = tab.kind;
    const value = el('input'); value.maxLength = 1500; value.value = tab.value; value.autocomplete = 'off';
    const suggestions = el('datalist'); suggestions.id = 'oc-tabs-labels';
    for (const label of labels()) { const option = el('option'); option.value = label; suggestions.append(option); }
    const valueField = field('Search query or label name', value);
    const children = el('input'); children.type = 'checkbox'; children.checked = Boolean(tab.includeChildren);
    const childrenField = el('label', 'oc-tabs-children'); childrenField.append(children, document.createTextNode(' Include sublabels'));
    const help = el('p', 'oc-tabs-help');
    const colors = el('div', 'oc-tabs-colors');
    const background = el('input'); background.type = 'color'; background.value = tab.color;
    const foreground = el('input'); foreground.type = 'color'; foreground.value = tab.textColor;
    colors.append(field('Background', background), field('Text color', foreground));
    const preview = el('span', 'oc-tabs-preview', tab.name || 'Tab preview');
    const paint = () => { preview.textContent = name.value.trim() || 'Tab preview'; preview.style.backgroundColor = background.value; preview.style.color = foreground.value; };
    name.addEventListener('input', paint); background.addEventListener('input', paint); foreground.addEventListener('input', paint); paint();
    const adjust = () => {
      const label = type.value === 'label';
      valueField.hidden = type.value === 'inbox'; value.required = type.value !== 'inbox';
      childrenField.hidden = !label;
      value.placeholder = label ? 'Projects/Atlas' : 'is:unread has:attachment';
      if (label) value.setAttribute('list', suggestions.id); else value.removeAttribute('list');
      help.textContent = label ? 'Use the exact label name. Expand the label tree in Gmail before saving to include sublabels. Previously saved sublabels are kept.' : 'Use any Gmail search, such as from:client@example.com or category:updates is:unread.';
    };
    type.addEventListener('change', adjust); adjust();
    const error = el('p', 'oc-tabs-error'); error.setAttribute('role', 'alert');
    const actions = el('div', 'oc-tabs-dialog-actions');
    if (existing) {
      const remove = button('Delete tab', 'Delete tab', 'oc-tabs-delete');
      remove.addEventListener('click', async () => {
        remove.disabled = true;
        try { await change({ type: 'remove', id: tab.id }, email); closeEditor(); }
        catch (err) { error.textContent = err.message; remove.disabled = false; }
      });
      actions.append(remove);
    }
    const cancel = button('Cancel', 'Cancel'); cancel.addEventListener('click', closeEditor);
    const save = el('button', 'oc-tabs-save', 'Save'); save.type = 'submit'; actions.append(cancel, save);
    form.append(heading, caption, field('Tab name', name), field('Show', type), valueField, suggestions,
      childrenField, help, colors, preview, error, actions);
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (!name.value.trim() || (type.value !== 'inbox' && !value.value.trim())) { error.textContent = 'Enter a tab name and a search or label.'; return; }
      const next = { id: tab.id, name: name.value.trim(), kind: type.value, value: type.value === 'inbox' ? '' : value.value.trim(),
        color: background.value, textColor: foreground.value, includeChildren: type.value === 'label' && children.checked };
      if (next.includeChildren) {
        next.children = [...new Set([...(tab.children || []), ...labels()])].filter(label => label.startsWith(next.value + '/'));
        if (next.children.length > 100) { error.textContent = 'This tab supports up to 100 sublabels. Use a custom search for a larger group.'; return; }
      }
      save.disabled = true;
      try { await change({ type: 'save', tab: next }, email); closeEditor(); }
      catch (err) { error.textContent = err.message; save.disabled = false; }
    });
    modal.addEventListener('close', () => { modal.remove(); if (dialog === modal) dialog = null; if (origin?.isConnected) origin.focus(); });
    modal.append(form); document.body.append(modal); modal.showModal(); name.focus();
  }
  function removeBar() { bar?.remove(); bar = list = status = null; signature = ''; }
  async function scan() {
    if (!enabled) return;
    const email = account();
    const main = [...document.querySelectorAll('[role="main"]')].find(visible);
    if (!main || !email) { ++generation; mailbox = ''; removeBar(); closeEditor(); return; }
    if (mailbox !== email || !bar) {
      const token = ++generation;
      if (mailbox !== email) { removeBar(); closeEditor(); }
      mailbox = email;
      let saved;
      try { saved = await Store.get(email); } catch { return; }
      if (!enabled || token !== generation || account() !== email || !main.isConnected) return;
      tabs = saved;
      bar = el('nav', 'oc-tabs'); bar.setAttribute('aria-label', 'OmniClick saved Gmail views');
      list = el('div', 'oc-tabs-list');
      const tools = el('div', 'oc-tabs-tools');
      const pin = button('Save current Gmail view as a tab', 'Save view', 'oc-tabs-pin');
      pin.addEventListener('click', () => { const view = currentView(); if (view) editTab(null, pin, view); });
      const add = button('Add a tab', '+', 'oc-tabs-add'); add.addEventListener('click', () => editTab(null, add));
      tools.append(pin, add);
      status = el('span', 'oc-tabs-status'); status.setAttribute('role', 'status');
      bar.append(list, tools, status);
    }
    if (bar.parentElement !== main || main.firstElementChild !== bar) main.prepend(bar);
    render();
  }
  function schedule() { if (enabled && !timer) timer = setTimeout(() => { timer = null; scan(); }, 150); }
  function storageChanged(changes, area) {
    if (area !== 'local' || !mailbox || !changes[Store.key(mailbox)]) return;
    const email = mailbox, token = generation;
    Store.get(email).then(saved => {
      if (enabled && token === generation && email === mailbox) { tabs = saved; signature = ''; render(); }
    }).catch(() => tell('Could not read saved tabs. Refresh Gmail to try again.'));
  }
  OmniClick.register('gmail-tabs', {
    enable() {
      enabled = true;
      observer = new MutationObserver(schedule); observer.observe(document.documentElement, { childList: true, subtree: true });
      window.addEventListener('hashchange', schedule); chrome.storage.onChanged.addListener(storageChanged); scan();
    },
    disable() {
      enabled = false; ++generation; mailbox = ''; dragging = null;
      observer?.disconnect(); clearTimeout(timer); timer = null;
      window.removeEventListener('hashchange', schedule); chrome.storage.onChanged.removeListener(storageChanged);
      closeEditor(); removeBar(); tabs = [];
    },
  });
})();
