// 比較ページで使う統計（ブラウザ: window.Stats / Node: require）
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Stats = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const nums = (a) => a.filter((v) => v != null && isFinite(v));

  function median(a) {
    const s = nums(a).sort((x, y) => x - y);
    if (!s.length) return null;
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  function mean(a) {
    const s = nums(a);
    return s.length ? s.reduce((x, y) => x + y, 0) / s.length : null;
  }

  function quantile(a, q) {
    const s = nums(a).sort((x, y) => x - y);
    if (!s.length) return null;
    const pos = (s.length - 1) * q;
    const lo = Math.floor(pos), hi = Math.ceil(pos);
    return s[lo] + (s[hi] - s[lo]) * (pos - lo);
  }

  // 標準正規分布の累積分布関数
  function normCdf(z) {
    const t = 1 / (1 + 0.2316419 * Math.abs(z));
    const d = 0.3989422804014327 * Math.exp(-z * z / 2);
    const p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
    return z > 0 ? 1 - p : p;
  }

  // 平均順位（同順位は平均）
  function ranks(values) {
    const idx = values.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
    const r = new Array(values.length);
    for (let i = 0; i < idx.length;) {
      let j = i;
      while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
      i = j + 1;
    }
    return r;
  }

  // Wilcoxon 符号順位検定（対応あり、両側）。差が0のペアは除く（scipy の既定と同じ）
  // n <= 25 は正確な分布（同順位があっても、順位を2倍して整数にした並べ替え分布で計算）、それより多いと正規近似
  function wilcoxon(x, y) {
    const d = [];
    for (let i = 0; i < x.length; i++) {
      if (x[i] == null || y[i] == null || !isFinite(x[i]) || !isFinite(y[i])) continue;
      const v = y[i] - x[i];
      if (v !== 0) d.push(v);
    }
    const n = d.length;
    if (n === 0) return { n: 0, W: null, p: null, z: null, r: null, method: null };
    const rk = ranks(d.map(Math.abs));
    let wPlus = 0, wMinus = 0;
    d.forEach((v, i) => { if (v > 0) wPlus += rk[i]; else wMinus += rk[i]; });
    const W = Math.min(wPlus, wMinus);
    const mu = n * (n + 1) / 4;
    // 同順位の補正を入れた分散
    const tieGroups = new Map();
    rk.forEach((r) => tieGroups.set(r, (tieGroups.get(r) || 0) + 1));
    let tieAdj = 0;
    for (const t of tieGroups.values()) if (t > 1) tieAdj += t * t * t - t;
    const sigma = Math.sqrt(n * (n + 1) * (2 * n + 1) / 24 - tieAdj / 48);
    const z = sigma > 0 ? (wPlus - mu) / sigma : 0;

    let p, method;
    if (n <= 25) {
      const r2 = rk.map((r) => Math.round(r * 2));
      const total = r2.reduce((a, b) => a + b, 0);
      let dist = new Float64Array(total + 1);
      dist[0] = 1;
      for (const r of r2) {
        const next = new Float64Array(total + 1);
        for (let s = 0; s <= total; s++) {
          if (!dist[s]) continue;
          next[s] += dist[s];
          next[s + r] += dist[s];
        }
        dist = next;
      }
      const all = 2 ** n;
      const w2 = Math.round(W * 2);
      let lower = 0;
      for (let s = 0; s <= w2; s++) lower += dist[s];
      p = Math.min(1, 2 * lower / all);
      method = 'exact';
    } else {
      // 連続性補正つき正規近似
      const zc = sigma > 0 ? (Math.abs(wPlus - mu) - 0.5) / sigma : 0;
      p = Math.min(1, 2 * (1 - normCdf(Math.max(0, zc))));
      method = 'normal';
    }
    // 効果量 r = |Z| / sqrt(N)
    return { n, W, wPlus, p, z, r: Math.abs(z) / Math.sqrt(n), method };
  }

  // 単回帰 y = a + b x
  function linreg(xs, ys) {
    const pts = xs.map((x, i) => [x, ys[i]]).filter(([x, y]) => x != null && y != null && isFinite(x) && isFinite(y));
    const n = pts.length;
    if (n < 2) return null;
    const mx = pts.reduce((s, p) => s + p[0], 0) / n;
    const my = pts.reduce((s, p) => s + p[1], 0) / n;
    let sxx = 0, sxy = 0, syy = 0;
    for (const [x, y] of pts) { sxx += (x - mx) ** 2; sxy += (x - mx) * (y - my); syy += (y - my) ** 2; }
    if (sxx === 0) return null;
    const b = sxy / sxx;
    const a = my - b * mx;
    const r2 = syy > 0 ? (sxy * sxy) / (sxx * syy) : null;
    return { a, b, r2, n };
  }

  return { median, mean, quantile, ranks, wilcoxon, linreg, normCdf };
});
