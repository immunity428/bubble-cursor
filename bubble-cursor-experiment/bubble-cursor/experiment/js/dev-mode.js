// 開発者モード：各ターゲット（回答の点）が、どこからクリックすれば選ばれるかを画面に重ねて表示する
//
//   円        … その中のどこでクリックしても必ずそのターゲットが選ばれる、いちばん大きな円（半透明）
//   正確な範囲 … そのターゲットが選ばれる範囲そのもの（隣のターゲットとの中間で区切られた形）
//
// 表示用の要素はすべて pointer-events: none なので、クリックやバブルカーソルの判定
// （elementFromPoint による隠れたターゲットの除外）には影響しない。
//
// ショートカット（Alt + Shift + …。Mac は Option + Shift + …）
//   D: 開発者モードのオン/オフ  C: 円  R: 正確な範囲  L: ラベル  H: 情報パネル
(function (global) {
  'use strict';

  const G = global.BubbleGeometry;
  const GOLDEN = 137.508;

  function hsl(h, s, l) {
    s /= 100; l /= 100;
    const k = (n) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
  }
  const hueOf = (i) => (i * GOLDEN) % 360;

  function create(options) {
    const { bubble, root, getContext, onToggle } = options;
    const show = { circles: true, regions: false, labels: false, hud: true, ...(options.show || {}) };
    let enabled = false;
    let dirty = true;
    let rafId = 0;
    let mouse = null;
    let model = null;   // { targets, radii, limit, owners, areas, layer }

    // ---------- 表示用の要素 ----------
    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:2147483646;display:none;';
    const hud = document.createElement('div');
    hud.className = 'dev-hud';
    hud.setAttribute('aria-live', 'off');
    hud.style.display = 'none';
    document.body.append(canvas, hud);
    const ctx = canvas.getContext('2d');

    // ---------- 計算 ----------
    function rebuild() {
      dirty = false;
      const c = getContext();
      const W = innerWidth, H = innerHeight;
      const limit = c.maxRadius > 0 ? c.maxRadius : Infinity;
      const targets = c.active ? bubble.snapshot() : [];
      const maxR = Math.hypot(W, H);
      const radii = targets.map((_, i) => G.safeRadius(i, targets, limit, { maxR }));
      let owners = null, areas = null, layer = null;
      if (show.regions && targets.length) {
        owners = G.ownerGrid(targets, W, H, 3, limit);
        areas = G.areas(owners, targets.length);
        layer = regionLayer(owners);
      }
      model = { targets, radii, limit, owners, areas, layer, W, H, condition: c.condition, maxRadius: c.maxRadius };
    }

    // 正確な範囲を、ターゲットごとの色で塗った画像にする（境界は濃く）
    function regionLayer({ grid, cols, rows }) {
      const off = document.createElement('canvas');
      off.width = cols;
      off.height = rows;
      const g = off.getContext('2d');
      const img = g.createImageData(cols, rows);
      const colors = new Map();
      for (let r = 0; r < rows; r++) {
        for (let q = 0; q < cols; q++) {
          const o = grid[r * cols + q];
          if (o < 0) continue;
          if (!colors.has(o)) colors.set(o, hsl(hueOf(o), 70, 50));
          // 上下左右のどれかが別のターゲット（または選ばれない場所）なら境界
          const at = (qq, rr) => (qq < 0 || rr < 0 || qq >= cols || rr >= rows ? o : grid[rr * cols + qq]);
          const edge = at(q + 1, r) !== o || at(q - 1, r) !== o || at(q, r + 1) !== o || at(q, r - 1) !== o;
          const [R, Gr, B] = colors.get(o);
          const p = (r * cols + q) * 4;
          img.data[p] = R; img.data[p + 1] = Gr; img.data[p + 2] = B;
          img.data[p + 3] = edge ? 150 : 36;
        }
      }
      g.putImageData(img, 0, 0);
      return off;
    }

    // ---------- 描画 ----------
    function draw() {
      rafId = 0;
      if (!enabled) return;
      const c = getContext();
      if (dirty || !model || model.W !== innerWidth || model.H !== innerHeight) rebuild();
      const W = innerWidth, H = innerHeight;
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
        canvas.width = Math.round(W * dpr);
        canvas.height = Math.round(H * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      canvas.style.display = c.active ? 'block' : 'none';
      if (!c.active) { renderHud(c, -1); return; }

      const { targets, radii, layer } = model;
      if (show.regions && layer) {
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(layer, 0, 0, layer.width * 3, layer.height * 3);
      }

      const sel = mouse ? G.owner(mouse.x, mouse.y, targets, model.limit) : -1;
      // バブルなしの条件では、実際にはターゲットの上でしか選べないので点線で描く
      const bubbleOn = c.condition === 'on';
      if (show.circles) {
        targets.forEach((t, i) => {
          const ctr = G.center(t);
          const h = hueOf(i);
          ctx.beginPath();
          ctx.arc(ctr.x, ctr.y, radii[i], 0, Math.PI * 2);
          ctx.fillStyle = `hsla(${h} 70% 50% / ${i === sel ? 0.3 : 0.14})`;
          ctx.fill();
          ctx.setLineDash(bubbleOn ? [] : [5, 4]);
          ctx.lineWidth = i === sel ? 2.5 : 1.25;
          ctx.strokeStyle = `hsla(${h} 70% 38% / ${i === sel ? 0.95 : 0.6})`;
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.beginPath();
          ctx.arc(ctr.x, ctr.y, 2.5, 0, Math.PI * 2);
          ctx.fillStyle = `hsl(${h} 70% 35%)`;
          ctx.fill();
        });
      }
      // 選ばれるターゲットを枠で示し、カーソルから線を引く
      if (sel >= 0) {
        const t = targets[sel];
        ctx.lineWidth = 2;
        ctx.strokeStyle = `hsl(${hueOf(sel)} 70% 35%)`;
        if (t.shape === 'circle') {
          ctx.beginPath();
          ctx.arc(t.x + t.w / 2, t.y + t.h / 2, Math.min(t.w, t.h) / 2 + 3, 0, Math.PI * 2);
          ctx.stroke();
        } else {
          ctx.strokeRect(t.x - 3, t.y - 3, t.w + 6, t.h + 6);
        }
        const ctr = G.center(t);
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(mouse.x, mouse.y);
        ctx.lineTo(ctr.x, ctr.y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (show.labels) {
        ctx.font = '600 11px system-ui, sans-serif';
        ctx.textAlign = 'center';
        targets.forEach((t, i) => {
          const ctr = G.center(t);
          const text = `${t.tid} r=${Math.round(radii[i])}`;
          const y = t.y - 6;
          const w = ctx.measureText(text).width + 8;
          ctx.fillStyle = 'rgba(255,255,255,.85)';
          ctx.fillRect(ctr.x - w / 2, y - 11, w, 14);
          ctx.fillStyle = `hsl(${hueOf(i)} 70% 28%)`;
          ctx.fillText(text, ctr.x, y);
        });
        ctx.textAlign = 'start';
      }
      renderHud(c, sel);
    }

    const fmt = (v) => (v == null || !isFinite(v) ? '–' : String(Math.round(v)));

    function renderHud(c, sel) {
      hud.style.display = show.hud ? 'block' : 'none';
      if (!show.hud) return;
      const rows = [];
      rows.push(['条件', c.active ? (c.condition === 'on' ? 'バブルあり' : 'バブルなし（実際はターゲットの上だけ）') : '（計測画面ではない）']);
      rows.push(['最大半径', c.maxRadius > 0 ? `${c.maxRadius}px` : '上限なし']);
      if (c.active && model) {
        const { targets, radii } = model;
        rows.push(['カーソル', mouse ? `${Math.round(mouse.x)}, ${Math.round(mouse.y)}` : '–']);
        if (sel >= 0) {
          const t = targets[sel];
          rows.push(['選ばれる', t.tid]);
          rows.push(['IntD', `${fmt(G.intD(mouse.x, mouse.y, t))}px`]);
          rows.push(['円の半径', `${fmt(radii[sel])}px`]);
          if (model.areas) rows.push(['範囲の面積', `${fmt(model.areas[sel])}px²`]);
        } else {
          rows.push(['選ばれる', mouse ? 'なし' : '–']);
        }
        if (targets.length) {
          let mi = 0;
          radii.forEach((r, i) => { if (r < radii[mi]) mi = i; });
          rows.push(['ターゲット数', String(targets.length)]);
          rows.push(['最小の円', `${targets[mi].tid}（${fmt(radii[mi])}px）`]);
        }
      }
      const flag = (on, label, key) => `<span class="${on ? 'on' : ''}">${key} ${label}</span>`;
      hud.innerHTML =
        '<p class="dev-title">開発者モード</p>' +
        `<dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${escapeHtml(v)}</dd>`).join('')}</dl>` +
        `<p class="dev-keys">Alt+Shift+ ${flag(show.circles, '円', 'C')} ${flag(show.regions, '範囲', 'R')} ` +
        `${flag(show.labels, 'ラベル', 'L')} <span>H 隠す</span> <span>D 終了</span></p>`;
    }

    function escapeHtml(s) {
      return String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
    }

    function schedule() {
      if (enabled && !rafId) rafId = requestAnimationFrame(draw);
    }
    function invalidate() {
      dirty = true;
      schedule();
    }

    // ---------- イベント ----------
    const mo = new MutationObserver(invalidate);
    mo.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'class', 'style', 'hidden'] });
    window.addEventListener('pointermove', (e) => {
      if (!enabled) return;
      mouse = { x: e.clientX, y: e.clientY };
      schedule();
    }, { capture: true, passive: true });
    window.addEventListener('resize', invalidate, { passive: true });
    window.addEventListener('scroll', invalidate, { capture: true, passive: true });

    window.addEventListener('keydown', (e) => {
      if (!e.altKey || !e.shiftKey || e.ctrlKey || e.metaKey) return;
      const key = { KeyD: 'dev', KeyC: 'circles', KeyR: 'regions', KeyL: 'labels', KeyH: 'hud' }[e.code];
      if (!key) return;
      if (key !== 'dev' && !enabled) return;
      e.preventDefault();
      e.stopPropagation();
      if (key === 'dev') api.setEnabled(!enabled, 'key');
      else {
        show[key] = !show[key];
        if (key === 'regions') dirty = true;
        schedule();
      }
    }, true);

    const api = {
      setEnabled(on, source) {
        on = !!on;
        if (on === enabled) return;
        enabled = on;
        if (!on) {
          if (rafId) cancelAnimationFrame(rafId);
          rafId = 0;
          canvas.style.display = 'none';
          hud.style.display = 'none';
        } else invalidate();
        if (typeof onToggle === 'function') onToggle(enabled, source || 'api');
      },
      isEnabled: () => enabled,
      refresh: invalidate,
      setShow(next) { Object.assign(show, next); invalidate(); },
      // テスト・確認用
      model: () => (dirty || !model ? (rebuild(), model) : model)
    };
    return api;
  }

  global.DevMode = { create };
})(window);
