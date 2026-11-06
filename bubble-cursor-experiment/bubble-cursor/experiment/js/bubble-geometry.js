// バブルカーソルで「どこからクリックすれば、どのターゲットが選ばれるか」を計算する。
// ブラウザ（window.BubbleGeometry）でも Node（require）でも動く。
//
// ターゲット t = { x, y, w, h, shape }  … 左上の座標と大きさ（CSS px）。shape が 'circle' なら円、それ以外は長方形
//
// バブルカーソルは、カーソルから IntD（ターゲットの一番近い点までの距離）が最も小さいターゲットを選ぶ。
// したがって、ターゲット j を選べる範囲は「IntD_j がほかのどのターゲットの IntD より小さい点の集まり」
// （距離をターゲットまでの距離にしたボロノイ領域）になる。最大半径 limit があるときは IntD_j <= limit も条件になる。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BubbleGeometry = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // bubble-cursor.js の computeSelection と同じ式
  function intD(px, py, t) {
    if (t.shape === 'circle') {
      const rad = Math.min(t.w, t.h) / 2;
      return Math.max(0, Math.hypot(px - (t.x + t.w / 2), py - (t.y + t.h / 2)) - rad);
    }
    const dx = Math.max(t.x - px, 0, px - (t.x + t.w));
    const dy = Math.max(t.y - py, 0, py - (t.y + t.h));
    return Math.hypot(dx, dy);
  }

  // (px, py) でクリックしたときに選ばれるターゲットの番号。どれも選ばれなければ -1
  // 同じ距離のときは先に並んでいるターゲット（bubble-cursor.js の安定ソートと同じ）
  function owner(px, py, targets, limit = Infinity) {
    let best = -1, bestD = Infinity;
    for (let i = 0; i < targets.length; i++) {
      const d = intD(px, py, targets[i]);
      if (d < bestD) { bestD = d; best = i; }
    }
    return bestD <= limit ? best : -1;
  }

  const center = (t) => ({ x: t.x + t.w / 2, y: t.y + t.h / 2 });

  // ターゲット i の中心を中心にした円で、その中のどこでクリックしても必ず i が選ばれる最大の半径。
  // 中心から放射状に線を伸ばし、はじめて i 以外になる（または何も選ばれなくなる）までの距離の最小値を求める。
  //   rays: 方向の数 / step: 粗く進む幅(px) / maxR: 調べる最大距離
  function safeRadius(i, targets, limit = Infinity, opts = {}) {
    const rays = opts.rays || 180;
    const step = opts.step || 2;
    const maxR = opts.maxR || 4000;
    const c = center(targets[i]);
    let best = maxR;
    for (let k = 0; k < rays; k++) {
      const a = (k / rays) * Math.PI * 2;
      const ux = Math.cos(a), uy = Math.sin(a);
      let inside = 0;
      let s = step;
      // ほかの方向で見つかった最小値より先は調べなくてよい
      while (s < best) {
        if (owner(c.x + ux * s, c.y + uy * s, targets, limit) !== i) break;
        inside = s;
        s += step;
      }
      if (s >= best) {
        // 粗い刻みの最後と best のあいだに境界がないかを確かめる
        if (owner(c.x + ux * best, c.y + uy * best, targets, limit) === i) continue;
        s = best;
      }
      // inside（i の中）と s（i の外）のあいだを二分探索で詰める
      let lo = inside, hi = s;
      for (let n = 0; n < 12; n++) {
        const mid = (lo + hi) / 2;
        if (owner(c.x + ux * mid, c.y + uy * mid, targets, limit) === i) lo = mid; else hi = mid;
      }
      best = Math.min(best, lo);
    }
    return best;
  }

  // 画面全体を step px ごとに調べ、各マスでどのターゲットが選ばれるかを返す（正確な範囲の描画用）
  function ownerGrid(targets, W, H, step = 3, limit = Infinity) {
    const cols = Math.ceil(W / step), rows = Math.ceil(H / step);
    const grid = new Int16Array(cols * rows);
    for (let r = 0; r < rows; r++) {
      const py = (r + 0.5) * step;
      for (let q = 0; q < cols; q++) grid[r * cols + q] = owner((q + 0.5) * step, py, targets, limit);
    }
    return { grid, cols, rows, step };
  }

  // 各ターゲットの範囲の面積（px²）。範囲の広さの比較用
  function areas(owners, n) {
    const a = new Array(n).fill(0);
    const cell = owners.step * owners.step;
    for (const o of owners.grid) if (o >= 0) a[o] += cell;
    return a;
  }

  return { intD, owner, center, safeRadius, ownerGrid, areas };
});
