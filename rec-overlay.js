// Injected into the recorded tab only while recording. Tab capture records page pixels but not the
// OS cursor, so this draws a cursor, click ripples, link highlights and typed keys into the page.
(() => {
  if (window.__omniclickRecStop) return;
  const opts = window.__omniclickRecOpts || {};

  const host = document.createElement('div');
  host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;';
  const root = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = `
    .cursor { position: fixed; left: 0; top: 0; width: 26px; height: 26px; margin: -13px 0 0 -13px; border-radius: 50%;
      background: rgba(255, 196, 0, .35); border: 2px solid rgba(240, 150, 0, .95); display: none; }
    .ripple { position: fixed; width: 22px; height: 22px; margin: -11px 0 0 -11px; border-radius: 50%;
      border: 3px solid #1a73e8; animation: rip .6s ease-out forwards; }
    @keyframes rip { from { transform: scale(.5); opacity: 1; } to { transform: scale(3.4); opacity: 0; } }
    .target { position: fixed; border: 3px solid #1a73e8; border-radius: 6px; box-shadow: 0 0 0 5px rgba(26, 115, 232, .25);
      animation: fade 1.4s ease-out forwards; }
    @keyframes fade { 0%, 60% { opacity: 1; } 100% { opacity: 0; } }
    .keys { position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%); max-width: 80vw; padding: 8px 16px;
      background: rgba(32, 33, 36, .9); color: #fff; font: 600 20px/1.4 system-ui, sans-serif; border-radius: 10px;
      white-space: pre-wrap; word-break: break-word; opacity: 0; transition: opacity .15s; }
    .keys.on { opacity: 1; }
    .key { display: inline-block; padding: 0 8px; margin: 0 2px; border-radius: 6px; background: rgba(255, 255, 255, .22); font-size: 16px; }
  `;
  const cursor = document.createElement('div');
  cursor.className = 'cursor';
  const keysBar = document.createElement('div');
  keysBar.className = 'keys';
  root.append(style, cursor, keysBar);
  document.documentElement.appendChild(host);

  const NAMES = { Enter: '⏎', Backspace: '⌫', Delete: 'Del', Tab: '⇥', Escape: 'Esc', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' };
  const MODIFIERS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'AltGraph']);
  const origin = (e) => (e.composedPath && e.composedPath()[0]) || e.target;

  function spawn(className, x, y) {
    const el = document.createElement('div');
    el.className = className;
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    root.appendChild(el);
    setTimeout(() => el.remove(), 1500);
    return el;
  }

  function onMove(e) {
    cursor.style.display = 'block';
    cursor.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
  }

  function onDown(e) {
    spawn('ripple', e.clientX, e.clientY);
    const t = origin(e);
    const clickable = t && t.closest && t.closest('a[href], button, [role="button"], input[type="submit"], input[type="button"]');
    if (clickable) {
      const r = clickable.getBoundingClientRect();
      const box = spawn('target', r.left - 3, r.top - 3);
      box.style.width = r.width + 'px';
      box.style.height = r.height + 'px';
    }
  }

  let items = [];
  let clearTimer = null;
  function render() {
    keysBar.replaceChildren(...items.map((it) => {
      if (!it.key) return document.createTextNode(it.text);
      const k = document.createElement('span');
      k.className = 'key';
      k.textContent = it.text;
      return k;
    }));
    keysBar.classList.toggle('on', items.length > 0);
  }

  function onKey(e) {
    if (MODIFIERS.has(e.key)) return;
    const t = origin(e);
    const secret = t && (t.type === 'password' || /cc-|one-time-code/.test(t.autocomplete || ''));
    let item;
    if ((e.ctrlKey || e.metaKey || e.altKey) && !secret) {
      const parts = [e.ctrlKey && 'Ctrl', e.metaKey && 'Cmd', e.altKey && 'Alt', e.shiftKey && 'Shift', e.key.length === 1 ? e.key.toUpperCase() : (NAMES[e.key] || e.key)];
      item = { key: true, text: parts.filter(Boolean).join('+') };
    } else if (e.key.length === 1) {
      item = { key: false, text: secret ? '•' : e.key };
    } else {
      item = { key: true, text: NAMES[e.key] || e.key };
    }
    items = items.concat(item).slice(-40);
    render();
    clearTimeout(clearTimer);
    clearTimer = setTimeout(() => { items = []; render(); }, 1800);
  }

  if (opts.pointer) {
    window.addEventListener('mousemove', onMove, true);
    window.addEventListener('mousedown', onDown, true);
  }
  if (opts.keys) window.addEventListener('keydown', onKey, true);

  window.__omniclickRecStop = () => {
    window.removeEventListener('mousemove', onMove, true);
    window.removeEventListener('mousedown', onDown, true);
    window.removeEventListener('keydown', onKey, true);
    clearTimeout(clearTimer);
    host.remove();
    delete window.__omniclickRecStop;
  };
})();
