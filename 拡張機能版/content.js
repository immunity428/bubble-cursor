// Bubble Cursor - content script
// 参考: Grossman, T. and Balakrishnan, R. (2005). The Bubble Cursor: Enhancing Target
// Acquisition by Dynamic Resizing of the Cursor's Activation Area. CHI '05, 281-290.
(() => {
  'use strict';
  if (window.top !== window) return;
  if (window.__bubbleCursorLoaded) return;
  window.__bubbleCursorLoaded = true;

  const DEFAULTS = { enabled: true, showBubble: true, maxRadius: 200 };

  // クリック対象（ターゲット）とみなす要素
  const SELECTOR = [
    'a[href]', 'button', 'input:not([type="hidden"])', 'select', 'textarea', 'summary',
    'label[for]', '[role="button"]', '[role="link"]', '[role="checkbox"]', '[role="radio"]',
    '[role="tab"]', '[role="menuitem"]', '[role="option"]', '[role="switch"]',
    '[onclick]', '[contenteditable="true"]', '[tabindex]:not([tabindex="-1"])'
  ].join(',');

  const RECOLLECT_INTERVAL = 300;  // ターゲット一覧を取り直す最短間隔(ms)
  const CLICK_MOVE_TOLERANCE = 6;  // これ以上動いたらドラッグとみなして補正しない(px)
  const MAX_CHECKS = 40;           // 隠れていないか確認する候補の上限

  let settings = { ...DEFAULTS };
  let targets = [];
  let dirty = true;
  let lastCollect = 0;
  let recollectTimer = 0;
  let mouse = null;
  let selection = null;
  let rafId = 0;
  let altHeld = false;
  let downPos = null;

  // ---------- 描画用オーバーレイ（Shadow DOMでページのCSSから隔離） ----------
  const host = document.createElement('bubble-cursor-overlay');
  host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647;';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
    <style>
      :host { all: initial; }
      div { position: fixed; left: 0; top: 0; box-sizing: border-box; pointer-events: none; display: none; }
      .bubble { border-radius: 50%; background: rgba(61,111,216,.16); border: 1.5px solid rgba(61,111,216,.6); }
      .morph  { border-radius: 8px;  background: rgba(61,111,216,.16); border: 1.5px solid rgba(61,111,216,.6); }
      .hit    { border-radius: 5px;  border: 2px solid rgba(37,84,190,.95); }
      .hit.flash { animation: flash .25s ease-out; }
      @keyframes flash { from { background: rgba(61,111,216,.4); } to { background: transparent; } }
      @media (prefers-reduced-motion: reduce) { .hit.flash { animation: none; } }
    </style>
    <div class="bubble"></div><div class="morph"></div><div class="hit"></div>`;
  const bubbleEl = root.querySelector('.bubble');
  const morphEl = root.querySelector('.morph');
  const hitEl = root.querySelector('.hit');
  (document.body || document.documentElement).appendChild(host);

  // ---------- ターゲット収集 ----------
  function collect() {
    dirty = false;
    lastCollect = performance.now();
    const list = [];
    for (const el of document.querySelectorAll(SELECTOR)) {
      if (el.disabled || el.getAttribute('aria-disabled') === 'true') continue;
      list.push(el);
    }
    targets = list;
  }

  new MutationObserver(() => { dirty = true; }).observe(document.documentElement, {
    childList: true, subtree: true, attributes: true,
    attributeFilter: ['href', 'disabled', 'aria-disabled', 'role', 'tabindex', 'contenteditable', 'onclick', 'type']
  });

  // 要素が他の要素に隠れていないか（中心点のヒットテスト）
  function isTopmost(el, r) {
    const x = Math.min(Math.max(r.left + r.width / 2, 0), innerWidth - 1);
    const y = Math.min(Math.max(r.top + r.height / 2, 0), innerHeight - 1);
    const hit = document.elementFromPoint(x, y);
    return !!hit && (hit === el || el.contains(hit));
  }

  // ---------- 論文のアルゴリズム ----------
  // IntD: カーソルからターゲットの一番近い点までの距離
  // ConD: カーソルからターゲットの一番遠い点までの距離
  // 一番近いターゲット j と2番目 k について、半径 = min(ConD_j, IntD_k)
  function computeSelection(x, y) {
    const limit = settings.maxRadius > 0 ? settings.maxRadius : Infinity;
    const vw = innerWidth, vh = innerHeight;
    const cands = [];
    for (const el of targets) {
      if (!el.isConnected) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      if (r.bottom < 0 || r.right < 0 || r.top > vh || r.left > vw) continue;
      const dx = Math.max(r.left - x, 0, x - r.right);
      const dy = Math.max(r.top - y, 0, y - r.bottom);
      const intD = Math.hypot(dx, dy);
      if (intD > limit) continue;
      cands.push({ el, r, intD });
    }
    if (!cands.length) return null;
    cands.sort((a, b) => a.intD - b.intD);

    const valid = [];
    for (let i = 0; i < cands.length && i < MAX_CHECKS && valid.length < 2; i++) {
      if (isTopmost(cands[i].el, cands[i].r)) valid.push(cands[i]);
    }
    if (!valid.length) return null;

    const j = valid[0];
    const intK = valid[1] ? valid[1].intD : Infinity;
    const r = j.r;
    const conD = Math.hypot(Math.max(x - r.left, r.right - x), Math.max(y - r.top, r.bottom - y));
    const radius = Math.min(conD, intK, limit);
    return { el: j.el, rect: r, radius, contained: conD <= radius };
  }

  // ---------- 描画 ----------
  function hideAll() {
    bubbleEl.style.display = morphEl.style.display = hitEl.style.display = 'none';
  }

  function place(el, left, top, w, h) {
    el.style.display = 'block';
    el.style.width = `${w}px`;
    el.style.height = `${h}px`;
    el.style.transform = `translate(${left}px, ${top}px)`;
  }

  function render() {
    if (!selection || !mouse || !settings.showBubble) { hideAll(); return; }
    const { rect: r, radius, contained } = selection;
    place(bubbleEl, mouse.x - radius, mouse.y - radius, radius * 2, radius * 2);
    // バブルがターゲットを包みきれないときは、ターゲット側にもう1つ小さなバブルを出す（論文の Figure 3d）
    if (contained) morphEl.style.display = 'none';
    else place(morphEl, r.left - 4, r.top - 4, r.width + 8, r.height + 8);
    place(hitEl, r.left - 2, r.top - 2, r.width + 4, r.height + 4);
  }

  function update() {
    rafId = 0;
    if (!settings.enabled || altHeld || !mouse) { selection = null; render(); return; }
    if (dirty) {
      if (performance.now() - lastCollect > RECOLLECT_INTERVAL) collect();
      else if (!recollectTimer) {
        recollectTimer = setTimeout(() => { recollectTimer = 0; schedule(); }, RECOLLECT_INTERVAL);
      }
    }
    selection = computeSelection(mouse.x, mouse.y);
    render();
  }

  function schedule() {
    if (!rafId) rafId = requestAnimationFrame(update);
  }

  // ---------- クリックの補正 ----------
  // ページ自体が操作を受け付けていそうな場所（ドラッグできるブロック、テキストエディタなど）は横取りしない
  function isInteractive(t) {
    if (!(t instanceof Element)) return false;
    if (t.closest(SELECTOR) || t.closest('[draggable="true"]')) return true;
    const c = getComputedStyle(t).cursor;
    return !(c === 'auto' || c === 'default' || c === '');
  }

  function flash() {
    hitEl.classList.remove('flash');
    void hitEl.offsetWidth;
    hitEl.classList.add('flash');
  }

  function activate(el) {
    flash();
    const r = el.getBoundingClientRect();
    const base = {
      bubbles: true, cancelable: true, composed: true, view: window,
      clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0
    };
    try { el.focus({ preventScroll: true }); } catch (_) { /* noop */ }
    el.dispatchEvent(new PointerEvent('pointerdown', { ...base, buttons: 1, pointerType: 'mouse', isPrimary: true }));
    el.dispatchEvent(new MouseEvent('mousedown', { ...base, buttons: 1 }));
    el.dispatchEvent(new PointerEvent('pointerup', { ...base, pointerType: 'mouse', isPrimary: true }));
    el.dispatchEvent(new MouseEvent('mouseup', base));
    if (el instanceof HTMLSelectElement && typeof el.showPicker === 'function') {
      try { el.showPicker(); return; } catch (_) { /* fall through */ }
    }
    if (typeof el.click === 'function') el.click();
    else el.dispatchEvent(new MouseEvent('click', base));
  }

  function onClick(e) {
    if (!e.isTrusted || e.button !== 0 || !settings.enabled || altHeld) return;
    if (e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (downPos && Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y) > CLICK_MOVE_TOLERANCE) return;

    const sel = computeSelection(e.clientX, e.clientY);
    if (!sel) return;
    const path = e.composedPath();
    if (path.includes(sel.el)) return;     // 普通にターゲットをクリックできている
    if (isInteractive(path[0])) return;

    e.preventDefault();
    e.stopImmediatePropagation();
    activate(sel.el);
  }

  // ---------- イベント登録 ----------
  const passive = { capture: true, passive: true };
  window.addEventListener('mousemove', (e) => {
    if (!e.isTrusted) return;
    mouse = { x: e.clientX, y: e.clientY };
    schedule();
  }, passive);
  window.addEventListener('mousedown', (e) => {
    if (e.isTrusted && e.button === 0) downPos = { x: e.clientX, y: e.clientY };
  }, passive);
  window.addEventListener('click', onClick, true);
  window.addEventListener('scroll', schedule, passive);
  window.addEventListener('resize', schedule, passive);
  window.addEventListener('mouseout', (e) => {
    if (!e.relatedTarget) { mouse = null; schedule(); }
  }, passive);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Alt' && !altHeld) { altHeld = true; schedule(); }
  }, true);
  window.addEventListener('keyup', (e) => {
    if (e.key === 'Alt') { altHeld = false; schedule(); }
  }, true);
  window.addEventListener('blur', () => { altHeld = false; mouse = null; schedule(); });

  // ---------- 設定 ----------
  chrome.storage.sync.get(DEFAULTS).then((s) => { settings = { ...DEFAULTS, ...s }; schedule(); });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    for (const [k, v] of Object.entries(changes)) if (k in DEFAULTS) settings[k] = v.newValue;
    schedule();
  });
})();
