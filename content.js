(() => {
  const AUDIO_RE = /\.(mp3|wav|m4a|aac|ogg|oga|opus|flac)$/i;
  const EXT_TYPES = { mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', flac: 'audio/flac' };
  const SPEEDS = [1, 1.25, 1.5, 2, 0.75];
  const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };

  const account = () => (location.pathname.match(/^\/mail\/u\/\d+/) || ['/mail/u/0'])[0];

  // Picks the MIME type from the file's magic bytes, falling back to its extension.
  function sniffType(buf, name) {
    const b = new Uint8Array(buf, 0, Math.min(12, buf.byteLength));
    const str = (o, n) => String.fromCharCode(...b.slice(o, o + n));
    if (str(0, 4) === 'RIFF') return 'audio/wav';
    if (str(0, 4) === 'OggS') return 'audio/ogg';
    if (str(0, 4) === 'fLaC') return 'audio/flac';
    if (str(4, 4) === 'ftyp') return 'audio/mp4';
    if (b[0] === 0xff && (b[1] & 0xf6) === 0xf0) return 'audio/aac';
    if (str(0, 3) === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return 'audio/mpeg';
    const ext = ((name || '').match(/\.(\w+)$/) || [])[1];
    return EXT_TYPES[(ext || '').toLowerCase()] || 'audio/mpeg';
  }

  // Fetches an attachment and returns a blob URL Chrome can play. GSM-in-WAV is decoded to PCM.
  async function toBlobUrl(url, name) {
    const resp = await fetch(url, { credentials: 'include' });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const buf = await resp.arrayBuffer();
    const pcm = GapGsm.toPcmWav(buf);
    return URL.createObjectURL(new Blob([pcm || buf], { type: pcm ? 'audio/wav' : sniffType(buf, name) }));
  }

  let active = false;
  let current = null;
  function stopCurrent() {
    if (current) current.audio.pause();
    current = null;
  }

  function buildPlayer(name, blobUrl, onClose) {
    const wrap = document.createElement('div');
    wrap.className = 'gap-player';
    const label = document.createElement('span');
    label.className = 'gap-name';
    label.textContent = name;
    label.title = name;
    const audio = document.createElement('audio');
    audio.controls = true;
    audio.src = blobUrl;
    const close = document.createElement('button');
    close.className = 'gap-close';
    close.textContent = '×';
    close.title = 'Close player';
    close.addEventListener('click', (e) => {
      e.stopPropagation();
      audio.pause();
      URL.revokeObjectURL(blobUrl);
      wrap.remove();
      if (onClose) onClose();
      if (current && current.wrap === wrap) current = null;
    });
    const speed = document.createElement('button');
    speed.className = 'gap-tool';
    speed.textContent = '1x';
    speed.title = 'Playback speed';
    speed.addEventListener('click', (e) => {
      e.stopPropagation();
      const next = SPEEDS[(SPEEDS.indexOf(audio.playbackRate) + 1) % SPEEDS.length];
      audio.playbackRate = next;
      speed.textContent = next + 'x';
    });
    const save = document.createElement('a');
    save.className = 'gap-tool';
    save.textContent = '⬇';
    save.title = 'Save a copy';
    save.href = blobUrl;
    save.download = name;
    save.addEventListener('click', (e) => e.stopPropagation());
    // Keep Gmail's single-key shortcuts from firing while the player has focus.
    wrap.tabIndex = 0;
    wrap.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.target !== wrap) return;
      if (e.key === 'ArrowLeft') audio.currentTime = Math.max(0, audio.currentTime - 5);
      else if (e.key === 'ArrowRight') audio.currentTime += 5;
      else if (e.key === ' ') audio.paused ? audio.play() : audio.pause();
      else return;
      e.preventDefault();
    });
    wrap.append(label, audio, speed, save, close);
    return { wrap, audio };
  }

  async function withLoading(btn, idleText, fn) {
    btn.disabled = true;
    btn.classList.remove('gap-error');
    if (idleText) btn.textContent = 'Loading…';
    try {
      await fn();
    } catch (err) {
      btn.title = String(err);
      btn.classList.add('gap-error');
      if (idleText) btn.textContent = 'Failed – retry';
      btn.disabled = false;
      return;
    }
    btn.disabled = false;
    if (idleText) btn.textContent = idleText;
  }

  // ---- Opened-email attachment cards (carry download_url="mime:name:url") ----
  function parseCard(card) {
    const m = /^([^:]*):(.*?):(https?:.*)$/.exec(card.getAttribute('download_url') || '');
    return m && AUDIO_RE.test(m[2]) ? { name: m[2], url: m[3] } : null;
  }

  function decorateCard(card) {
    const info = parseCard(card);
    if (!info) return;
    const btn = document.createElement('button');
    btn.className = 'gap-play-btn';
    btn.textContent = '▶ Play';
    btn.title = 'Play ' + info.name + ' without downloading';
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const existing = card._gapPlayer;
      if (existing && existing.wrap.isConnected) {
        stopCurrent();
        existing.audio.play();
        current = existing;
        return;
      }
      withLoading(btn, '▶ Play', async () => {
        const p = buildPlayer(info.name, await toBlobUrl(info.url, info.name), () => { card._gapPlayer = null; });
        (card.parentElement || card).after(p.wrap);
        card._gapPlayer = p;
        stopCurrent();
        current = p;
        p.audio.play().catch(() => {});
      });
    });
    card.appendChild(btn);
  }

  // ---- Inbox-list chips: no URL in the DOM, so resolve it from the thread's print view ----
  const threadCache = new Map();
  function threadAttachments(th) {
    if (!threadCache.has(th)) {
      const p = (async () => {
        document.dispatchEvent(new CustomEvent('omniclick-ik-request'));
        const ik = document.documentElement.dataset.gapIk;
        if (!ik) throw new Error('Gmail session key not available');
        const resp = await fetch(`${account()}/?ui=2&ik=${ik}&view=pt&search=all&th=${th}`, { credentials: 'include' });
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const html = await resp.text();
        const out = [];
        const re = /<a\b[^>]*href="([^"]*attid[^"]*)"[^>]*>/g;
        let m;
        while ((m = re.exec(html))) {
          const text = html.slice(m.index + m[0].length, m.index + m[0].length + 400)
            .replace(/<[^>]*>/g, '')
            .replace(/&(amp|lt|gt|quot|#39);/g, (e) => ENTITIES[e]);
          out.push({ url: new URL(m[1].replace(/&amp;/g, '&'), location.origin).href, text });
        }
        return out;
      })();
      p.catch(() => threadCache.delete(th));
      threadCache.set(th, p);
    }
    return threadCache.get(th);
  }

  async function resolveChipUrl(chip) {
    const row = chip.closest('tr.zA');
    const idEl = row && row.querySelector('[data-legacy-thread-id]');
    const th = idEl && idEl.getAttribute('data-legacy-thread-id');
    if (!th) throw new Error('Could not find the message id');
    const name = chip.title;
    const hit = (await threadAttachments(th))
      .map((a) => ({ a, i: a.text.indexOf(name) }))
      .filter((x) => x.i >= 0 && x.i < 200)
      .sort((x, y) => x.i - y.i)[0];
    if (!hit) throw new Error('Attachment link not found for ' + name);
    return hit.a.url;
  }

  function decorateChip(chip) {
    const btn = document.createElement('button');
    btn.className = 'gap-chip-btn';
    btn.textContent = '▶';
    btn.title = 'Play ' + chip.title + ' without downloading';
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      withLoading(btn, null, async () => {
        const url = await resolveChipUrl(chip);
        const p = buildPlayer(chip.title, await toBlobUrl(url, chip.title));
        p.wrap.classList.add('gap-floating');
        document.querySelectorAll('.gap-floating .gap-close').forEach((c) => c.click());
        document.body.appendChild(p.wrap);
        stopCurrent();
        current = p;
        p.audio.play().catch(() => {});
      });
    });
    chip.after(btn);
  }

  // ---- Gmail's own preview overlay: swap in a playable source when its player fails ----
  function fixViewerAudio(a) {
    const check = async () => {
      if (!active || a.dataset.gapFixed) return;
      const src = a.currentSrc || a.src;
      if (!src || !(a.error || a.networkState === 3)) return;
      a.dataset.gapFixed = '1';
      try {
        a.src = await toBlobUrl(src);
        a.load();
        a.play().catch(() => {});
      } catch (err) {
        delete a.dataset.gapFixed;
      }
    };
    a.addEventListener('error', check);
    setTimeout(check, 1500);
  }

  function scan() {
    document.querySelectorAll('[download_url]:not([data-gap-done])').forEach((card) => {
      card.dataset.gapDone = '1';
      decorateCard(card);
    });
    document.querySelectorAll('tr.zA div.brc[title]:not([data-gap-done])').forEach((chip) => {
      if (!AUDIO_RE.test(chip.title)) return;
      chip.dataset.gapDone = '1';
      decorateChip(chip);
    });
    document.querySelectorAll('[role="dialog"] audio:not([data-gap-watch])').forEach((a) => {
      a.dataset.gapWatch = '1';
      fixViewerAudio(a);
    });
  }

  let timer = null;
  let observer = null;
  OmniClick.register('gmail-audio', {
    enable() {
      active = true;
      observer = new MutationObserver(() => {
        clearTimeout(timer);
        timer = setTimeout(scan, 200);
      });
      observer.observe(document.body, { childList: true, subtree: true });
      scan();
    },
    disable() {
      active = false;
      if (observer) observer.disconnect();
      observer = null;
      clearTimeout(timer);
      stopCurrent();
      document.querySelectorAll('.gap-play-btn, .gap-chip-btn, .gap-player').forEach((n) => n.remove());
      document.querySelectorAll('[data-gap-done]').forEach((n) => delete n.dataset.gapDone);
      document.querySelectorAll('[data-gap-watch]').forEach((n) => delete n.dataset.gapWatch);
    },
  });
})();
