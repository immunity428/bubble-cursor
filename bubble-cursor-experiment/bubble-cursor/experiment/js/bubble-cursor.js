// Bubble Cursor - Webアプリ埋め込み版
// 拡張機能版 content.js の選択アルゴリズムをそのまま使い、chrome.storage への依存を外して
// 実験中に ON/OFF を切り替えられるようにしたもの。
//
// 参考: Grossman, T. and Balakrishnan, R. (2005). The Bubble Cursor: Enhancing Target
// Acquisition by Dynamic Resizing of the Cursor's Activation Area. CHI '05, 281-290.
//
// 使い方:
//   const bc = BubbleCursor.create({ root: document.getElementById('survey'), maxRadius: 0 });
//   bc.setEnabled(true);   // バブルあり条件
//   bc.setEnabled(false);  // バブルなし条件（描画もクリック補正もしない）
(function (global) {
  'use strict';

  const DEFAULTS = {
    root: null,                    // ターゲットを探す範囲（null なら document）
    selector: '[data-bc-target]',  // ターゲットとみなす要素
    maxRadius: 0,                  // バブル半径の上限(px)。0 = 上限なし（論文と同じ）
    showBubble: true,              // バブルを描画するか（false でもクリック補正は効く）
    enabled: false,
    onActivate: null               // バブルがクリックを補正したときに呼ばれる (info) => {}
  };

  const RECOLLECT_INTERVAL = 300;  // ターゲット一覧を取り直す最短間隔(ms)
  const CLICK_MOVE_TOLERANCE = 6;  // これ以上動いたらドラッグとみなして補正しない(px)
  const MAX_CHECKS = 40;           // 隠れていないか確認する候補の上限

  function create(options) {
    const opts = { ...DEFAULTS, ...options };
    const scope = opts.root || document;

    let targets = [];
    let dirty = true;
    let lastCollect = 0;
    let recollectTimer = 0;
    let mouse = null;
    let selection = null;
    let rafId = 0;
    let downPos = null;

    // ---------- 描画用オーバーレイ（Shadow DOMでページのCSSから隔離） ----------
    const host = document.createElement('bubble-cursor-overlay');
    host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647;';
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
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
    const bubbleEl = shadow.querySelector('.bubble');
    const morphEl = shadow.querySelector('.morph');
    const hitEl = shadow.querySelector('.hit');
    document.body.appendChild(host);

    // ---------- ターゲット収集 ----------
    function collect() {
      dirty = false;
      lastCollect = performance.now();
      const list = [];
      for (const el of scope.querySelectorAll(opts.selector)) {
        if (el.disabled || el.getAttribute('aria-disabled') === 'true') continue;
        list.push(el);
      }
      targets = list;
    }

    const observer = new MutationObserver(() => { dirty = true; schedule(); });
    observer.observe(scope === document ? document.documentElement : scope, {
      childList: true, subtree: true, attributes: true,
      attributeFilter: ['disabled', 'aria-disabled', 'data-bc-target', 'data-bc-shape', 'hidden', 'style']
    });

    function isTopmost(el, r) {
      const x = Math.min(Math.max(r.left + r.width / 2, 0), innerWidth - 1);
      const y = Math.min(Math.max(r.top + r.height / 2, 0), innerHeight - 1);
      const hit = document.elementFromPoint(x, y);
      return !!hit && (hit === el || el.contains(hit));
    }

    // ---------- 論文のアルゴリズム（拡張機能版と同じ） ----------
    // IntD: カーソルからターゲットの一番近い点までの距離
    // ConD: カーソルからターゲットの一番遠い点までの距離
    // 一番近いターゲット j と2番目 k について、半径 = min(ConD_j, IntD_k)
    function computeSelection(x, y) {
      if (dirty) collect();
      const limit = opts.maxRadius > 0 ? opts.maxRadius : Infinity;
      const vw = innerWidth, vh = innerHeight;
      const cands = [];
      for (const el of targets) {
        if (!el.isConnected) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) continue;
        if (r.bottom < 0 || r.right < 0 || r.top > vh || r.left > vw) continue;
        // data-bc-shape="circle" のターゲットは円として扱う（論文と同じ）。それ以外は長方形
        const circle = el.dataset.bcShape === 'circle';
        let intD, conD;
        if (circle) {
          const rad = Math.min(r.width, r.height) / 2;
          const d = Math.hypot(x - (r.left + r.width / 2), y - (r.top + r.height / 2));
          intD = Math.max(0, d - rad);
          conD = d + rad;
        } else {
          const dx = Math.max(r.left - x, 0, x - r.right);
          const dy = Math.max(r.top - y, 0, y - r.bottom);
          intD = Math.hypot(dx, dy);
          conD = Math.hypot(Math.max(x - r.left, r.right - x), Math.max(y - r.top, r.bottom - y));
        }
        if (intD > limit) continue;
        cands.push({ el, r, intD, conD, circle });
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
      const radius = Math.min(j.conD, intK, limit);
      return { el: j.el, rect: j.r, radius, intD: j.intD, circle: j.circle, contained: j.conD <= radius };
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
      if (!selection || !mouse || !opts.showBubble) { hideAll(); return; }
      const { rect: r, radius, contained, circle } = selection;
      morphEl.style.borderRadius = circle ? '50%' : '';
      hitEl.style.borderRadius = circle ? '50%' : '';
      place(bubbleEl, mouse.x - radius, mouse.y - radius, radius * 2, radius * 2);
      if (contained) morphEl.style.display = 'none';
      else place(morphEl, r.left - 4, r.top - 4, r.width + 8, r.height + 8);
      place(hitEl, r.left - 2, r.top - 2, r.width + 4, r.height + 4);
    }

    function update() {
      rafId = 0;
      if (!opts.enabled || !mouse) { selection = null; render(); return; }
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
    function isInteractive(t) {
      if (!(t instanceof Element)) return false;
      if (t.closest(opts.selector) || t.closest('a[href],button,input,select,textarea,[draggable="true"]')) return true;
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
      if (typeof el.click === 'function') el.click();
      else el.dispatchEvent(new MouseEvent('click', base));
    }

    function onClick(e) {
      if (!e.isTrusted || e.button !== 0 || !opts.enabled) return;
      if (e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (downPos && Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y) > CLICK_MOVE_TOLERANCE) return;

      const sel = computeSelection(e.clientX, e.clientY);
      if (!sel) return;
      const path = e.composedPath();
      if (path.includes(sel.el)) return;     // 普通にターゲットをクリックできている
      if (isInteractive(path[0])) return;

      e.preventDefault();
      e.stopImmediatePropagation();
      if (typeof opts.onActivate === 'function') {
        try {
          opts.onActivate({
            el: sel.el, t: performance.now(), x: e.clientX, y: e.clientY,
            radius: sel.radius, intD: sel.intD
          });
        } catch (err) { console.error(err); }
      }
      activate(sel.el);
    }

    // ---------- イベント登録 ----------
    const passive = { capture: true, passive: true };
    const handlers = [
      ['mousemove', (e) => { if (e.isTrusted) { mouse = { x: e.clientX, y: e.clientY }; schedule(); } }, passive],
      ['mousedown', (e) => { if (e.isTrusted && e.button === 0) downPos = { x: e.clientX, y: e.clientY }; }, passive],
      ['click', onClick, true],
      ['scroll', schedule, passive],
      ['resize', () => { dirty = true; schedule(); }, passive],
      ['mouseout', (e) => { if (!e.relatedTarget) { mouse = null; schedule(); } }, passive],
      ['blur', () => { mouse = null; schedule(); }, undefined]
    ];
    for (const [type, fn, o] of handlers) window.addEventListener(type, fn, o);

    return {
      setEnabled(on) { opts.enabled = !!on; dirty = true; schedule(); },
      isEnabled() { return opts.enabled; },
      setMaxRadius(px) { opts.maxRadius = Math.max(0, Number(px) || 0); schedule(); },
      getMaxRadius() { return opts.maxRadius; },
      setShowBubble(on) { opts.showBubble = !!on; schedule(); },
      refresh() { dirty = true; schedule(); },
      // バブルの有無に関係なく、その位置でバブルカーソルが選ぶターゲットを返す（分析用）
      peek(x, y) { return computeSelection(x, y); },
      // いまバブルカーソルが選ぶ可能性のあるターゲット（computeSelection と同じ条件で絞ったもの）
      // 戻り値は BubbleGeometry に渡せる形 { el, tid, x, y, w, h, shape }
      snapshot() {
        if (dirty) collect();
        const vw = innerWidth, vh = innerHeight;
        const out = [];
        for (const el of targets) {
          if (!el.isConnected) continue;
          const r = el.getBoundingClientRect();
          if (r.width < 1 || r.height < 1) continue;
          if (r.bottom < 0 || r.right < 0 || r.top > vh || r.left > vw) continue;
          out.push({
            el, tid: el.dataset.tid || '', x: r.left, y: r.top, w: r.width, h: r.height,
            shape: el.dataset.bcShape === 'circle' ? 'circle' : 'rect'
          });
        }
        return out;
      },
      destroy() {
        for (const [type, fn, o] of handlers) window.removeEventListener(type, fn, o);
        observer.disconnect();
        if (rafId) cancelAnimationFrame(rafId);
        clearTimeout(recollectTimer);
        host.remove();
      }
    };
  }

  global.BubbleCursor = { create };
})(window);
