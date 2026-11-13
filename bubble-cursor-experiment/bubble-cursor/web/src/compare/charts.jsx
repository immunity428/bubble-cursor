// 比較ページのグラフ（SVG を JSX で描く）
import { linreg, mean, median, quantile } from '../lib/stats.js';
import { AXES, COND_LABEL, fmt } from './model.js';

function niceTicks(min, max, count = 5) {
  if (min === max) { min -= 1; max += 1; }
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((s) => s >= raw) || 10 * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v / step) * step);
  return { lo, hi, ticks, step };
}
const tickLabel = (v, step) => v.toFixed(step >= 1 ? 0 : Math.min(3, Math.ceil(-Math.log10(step))));

// 参加者ごとに2つのグループの値を線で結ぶ図
export function PairedChart({ row, axis }) {
  const ax = AXES[axis];
  const [ga, gb] = ax.groups;
  if (!row || !row.pairs.length) return <p className="note">両方のグループに値がある参加者がいません。</p>;
  const W = 360, H = 300, L = 52, R = 16, T = 14, B = 36;
  const vals = row.pairs.flatMap((p) => [p.a, p.b]);
  const { lo, hi, ticks, step } = niceTicks(Math.min(...vals), Math.max(...vals));
  const y = (v) => T + (H - T - B) * (1 - (v - lo) / (hi - lo));
  const xa = L + (W - L - R) * 0.28, xb = L + (W - L - R) * 0.72;
  const unit = row.m.unit;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${row.m.label} の参加者ごとの比較`}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="#eceff4" />
          <text x={L - 6} y={y(t) + 4} textAnchor="end">{tickLabel(t, step)}</text>
        </g>
      ))}
      <line x1={L} x2={L} y1={T} y2={H - B} stroke="#c5ccd8" />
      {row.pairs.map((p) => (
        <line key={p.sid} x1={xa} x2={xb} y1={y(p.a)} y2={y(p.b)} stroke="#b6bfcf" strokeWidth="1.5">
          <title>{`${p.participant}: ${fmt(p.a, unit)} → ${fmt(p.b, unit)}（差 ${fmt(p.b - p.a, unit)}）`}</title>
        </line>
      ))}
      {[[xa, 'a', 'var(--c-a)'], [xb, 'b', 'var(--c-b)']].map(([x, key, color]) => {
        const med = median(row.pairs.map((p) => p[key]));
        return (
          <g key={key}>
            {row.pairs.map((p) => (
              <circle key={p.sid} cx={x} cy={y(p[key])} r="4.5" fill={color} stroke="#fff" strokeWidth="1.5">
                <title>{`${p.participant}: ${fmt(p[key], unit)}`}</title>
              </circle>
            ))}
            <line x1={x - 22} x2={x + 22} y1={y(med)} y2={y(med)} stroke="var(--ink)" strokeWidth="3" strokeLinecap="round" />
          </g>
        );
      })}
      <text x={xa} y={H - 12} textAnchor="middle" fontWeight="600">{ax.label[ga]}</text>
      <text x={xb} y={H - 12} textAnchor="middle" fontWeight="600">{ax.label[gb]}</text>
    </svg>
  );
}

// エイム課題：難易度 ID と移動時間の散布図と、条件ごとの当てはめ MT = a + b·ID
export function fittsFits(segments) {
  const segs = segments.filter((s) => s.task === 'aim' && s.included && s.fitts_id != null);
  const fits = {};
  for (const c of ['off', 'on']) {
    const list = segs.filter((s) => s.condition === c);
    fits[c] = { list, reg: linreg(list.map((s) => s.fitts_id), list.map((s) => s.time_total_ms)), tp: mean(list.map((s) => s.throughput_bps)) };
  }
  return { segs, fits };
}

export function FittsChart({ segs, fits }) {
  const colors = { off: 'var(--c-a)', on: 'var(--c-b)' };
  const W = 560, H = 320, L = 56, R = 16, T = 14, B = 40;
  const xs = segs.map((s) => s.fitts_id), ys = segs.map((s) => s.time_total_ms);
  const tx = niceTicks(Math.floor(Math.min(...xs)), Math.max(...xs), 6);
  const ty = niceTicks(0, quantile(ys, 0.98), 5);
  const x = (v) => L + (W - L - R) * (v - tx.lo) / (tx.hi - tx.lo);
  const y = (v) => T + (H - T - B) * (1 - (Math.min(v, ty.hi) - ty.lo) / (ty.hi - ty.lo));
  const midY = (T + H - B) / 2;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Fitts の法則の散布図">
      {ty.ticks.map((t) => (
        <g key={`y${t}`}>
          <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="#eceff4" />
          <text x={L - 6} y={y(t) + 4} textAnchor="end">{tickLabel(t, ty.step)}</text>
        </g>
      ))}
      {tx.ticks.map((t) => <text key={`x${t}`} x={x(t)} y={H - B + 16} textAnchor="middle">{tickLabel(t, tx.step)}</text>)}
      <line x1={L} x2={W - R} y1={H - B} y2={H - B} stroke="#c5ccd8" />
      <line x1={L} x2={L} y1={T} y2={H - B} stroke="#c5ccd8" />
      <text x={(L + W - R) / 2} y={H - 6} textAnchor="middle">難易度 ID (bit)</text>
      <text x={14} y={midY} textAnchor="middle" transform={`rotate(-90 14 ${midY})`}>移動時間 MT (ms)</text>
      {['off', 'on'].map((c) => fits[c].list.map((s, i) => (
        <circle key={`${c}${i}`} cx={x(s.fitts_id)} cy={y(s.time_total_ms)} r="3" fill={colors[c]} fillOpacity="0.45">
          <title>{`${s.participant} ${COND_LABEL[c]}: ID ${s.fitts_id}, ${s.time_total_ms} ms`}</title>
        </circle>
      )))}
      {['off', 'on'].map((c) => {
        const r = fits[c].reg;
        if (!r) return null;
        const ids = fits[c].list.map((s) => s.fitts_id);
        const x0 = Math.min(...ids), x1 = Math.max(...ids);
        return <line key={c} x1={x(x0)} x2={x(x1)} y1={y(r.a + r.b * x0)} y2={y(r.a + r.b * x1)} stroke={colors[c]} strokeWidth="2.5" />;
      })}
      {['off', 'on'].map((c, i) => (
        <g key={`lg${c}`}>
          <line x1={L + 12} x2={L + 32} y1={T + 10 + i * 18} y2={T + 10 + i * 18} stroke={colors[c]} strokeWidth="2.5" />
          <text x={L + 38} y={T + 14 + i * 18} fill="var(--ink)">{COND_LABEL[c]}</text>
        </g>
      ))}
    </svg>
  );
}
