(() => {
  let records = [];
  const $ = (id) => document.getElementById(id);
  const message = (value) => { $('message').textContent = value; };
  const el = (tag, text, cls) => {
    const node = document.createElement(tag);
    node.textContent = text;
    if (cls) node.className = cls;
    return node;
  };
  function render() {
    const query = $('search').value.toLowerCase().trim();
    const filtered = records.filter((n) => (!$('account').value || n.account === $('account').value) &&
      (!$('status').value || n.done === ($('status').value === 'done')) &&
      `${n.text} ${n.subject} ${n.account}`.toLowerCase().includes(query));
    const nodes = filtered.sort((a, b) => b.updatedAt - a.updatedAt).map((note) => {
      const card = el('article', '');
      card.style.backgroundColor = OmniNotes.colors[note.color];
      card.append(el('h2', (note.done ? '✓ ' : '') + (note.subject || '(No subject)')),
        el('div', `${note.account} · ${new Date(note.updatedAt).toLocaleString()}`, 'meta'), el('p', note.text));
      const link = el('a', 'Open email');
      // authuser identifies the mailbox by email instead of a reorderable /u/0 slot.
      link.href = `https://mail.google.com/mail/?authuser=${encodeURIComponent(note.account)}#all/${encodeURIComponent(note.thread)}`;
      link.target = '_blank'; link.rel = 'noopener';
      const remove = el('button', 'Delete'); remove.type = 'button';
      remove.addEventListener('click', async () => {
        if (!window.confirm('Delete this private note?')) return;
        try { await OmniNotes.put({ ...note, text: '' }); await load(); }
        catch { message('Could not delete the note. Please try again.'); }
      });
      card.append(link, remove);
      return card;
    });
    if (!nodes.length) nodes.push(el('p', 'No notes found. Enable Private Gmail notes in the OmniClick popup, then open an email.'));
    $('notes').replaceChildren(...nodes);
  }
  async function load() {
    try {
      records = await OmniNotes.all();
      const selected = $('account').value;
      const options = [el('option', 'All accounts')]; options[0].value = '';
      for (const email of [...new Set(records.map((n) => n.account))].sort()) {
        const option = el('option', email); option.value = email; options.push(option);
      }
      $('account').replaceChildren(...options);
      $('account').value = selected;
      render();
    } catch { message('Could not read notes. Please reload this page.'); }
  }
  $('search').addEventListener('input', render);
  $('account').addEventListener('change', render);
  $('status').addEventListener('change', render);
  $('export').addEventListener('click', async () => {
    try {
      const backup = { format: 'omniclick-gmail-notes', version: 1, exportedAt: new Date().toISOString(), notes: await OmniNotes.all() };
      const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }));
      const link = el('a', ''); link.href = url;
      link.download = `omniclick-notes-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      message(`Exported ${backup.notes.length} notes. Keep this backup private.`);
    } catch { message('Could not export notes. Please try again.'); }
  });
  $('import').addEventListener('click', () => $('file').click());
  $('file').addEventListener('change', async () => {
    const file = $('file').files[0];
    if (!file) return;
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error('Backup must be smaller than 5 MB.');
      const backup = JSON.parse(await file.text());
      if (backup.format !== 'omniclick-gmail-notes' || backup.version !== 1 || !Array.isArray(backup.notes) ||
          backup.notes.length > 5000 || !backup.notes.every(OmniNotes.valid)) throw new Error('This is not a valid OmniClick notes backup.');
      if (!window.confirm(`Import ${backup.notes.length} notes? Newer notes in this browser will be kept.`)) return;
      let imported = 0;
      for (const note of backup.notes) {
        const existing = await OmniNotes.get(note.account, note.thread);
        if (!existing || existing.updatedAt < note.updatedAt) { await OmniNotes.put(note); ++imported; }
      }
      await load(); message(`Imported ${imported} notes. Newer existing notes were kept.`);
    } catch (error) { message(`Import failed: ${error.message}`); }
    finally { $('file').value = ''; }
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && Object.keys(changes).some((key) => key.startsWith(OmniNotes.prefix))) load();
  });
  load();
})();
