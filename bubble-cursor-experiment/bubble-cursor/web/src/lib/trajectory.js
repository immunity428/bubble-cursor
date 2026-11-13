// 1ページ分のカーソル軌跡・回答点・ターゲットを canvas に描く（結果画面と比較ページで共通）
import { analyzeBlock, includedInSummary } from './analysis.js';
import { median } from './stats.js';

export const pageEvents = (block) => block.events.filter((e) => e.type === 'page');

export function pageLabel(pg) {
  if (pg.task === 'aim') return pg.practice ? 'エイム（練習）' : 'エイム';
  return pg.practice ? `${pg.page}（練習）` : pg.page;
}

// 戻り値: そのページの区間（回答点）の配列
export function drawTrajectory(canvas, block, pageIndex, params, qinfo) {
  const pg = pageEvents(block)[pageIndex];
  const ctx = canvas.getContext('2d');
  if (!pg) {
    canvas.width = 10;
    canvas.height = 10;
    return [];
  }
  const events = [...block.events].sort((a, b) => a.t - b.t);
  const endEv = events.find((e) => e.t > pg.t && (e.type === 'page' || e.type === 'screen' || e.type === 'block-end'));
  const tEnd = endEv ? endEv.t : Infinity;
  // ページが出る前の区間（前のページの「次へ」→このページ）も見えるよう、直前の選択から描く
  let prevSel = null;
  for (const e of events) if (e.type === 'select' && e.t <= pg.t) prevSel = e;
  let prevDown = null;
  if (prevSel) for (const e of events) if (e.type === 'down' && e.t <= prevSel.t) prevDown = e;
  const tStart = prevDown ? prevDown.t : pg.t;

  const vw = pg.viewport.w, vh = pg.viewport.h;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(vw * dpr);
  canvas.height = Math.round(vh * dpr);
  canvas.style.aspectRatio = `${vw} / ${vh}`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, vw, vh);

  ctx.lineWidth = 1;
  for (const t of pg.targets) {
    ctx.fillStyle = t.kind === 'next' ? '#e2e7f2' : '#eef3fc';
    ctx.strokeStyle = '#9fb2dd';
    if (t.shape === 'circle') {
      ctx.beginPath();
      ctx.arc(t.x + t.w / 2, t.y + t.h / 2, Math.min(t.w, t.h) / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.fillRect(t.x, t.y, t.w, t.h);
      ctx.strokeRect(t.x + 0.5, t.y + 0.5, t.w - 1, t.h - 1);
    }
  }

  const S = block.samples;
  ctx.strokeStyle = '#8a93a6';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  let started = false;
  for (let i = 0; i < S.t.length; i++) {
    if (S.t[i] < tStart || S.t[i] > tEnd) continue;
    if (!started) { ctx.moveTo(S.x[i], S.y[i]); started = true; } else ctx.lineTo(S.x[i], S.y[i]);
  }
  ctx.stroke();

  const blockSegs = analyzeBlock(block, params, qinfo);
  const segs = blockSegs.filter((s) => s.page === pg.page);
  const matched = new Set(blockSegs.map((s) => `${s.x1},${s.y1}`));
  // 回答点にならなかったクリック（空振り・エイムの誤選択）
  ctx.strokeStyle = '#e09a1a';
  ctx.lineWidth = 2;
  for (const d of events) {
    if (d.type !== 'down' || d.t < pg.t || d.t > tEnd || matched.has(`${d.x},${d.y}`)) continue;
    ctx.strokeRect(d.x - 5, d.y - 5, 10, 10);
  }
  ctx.font = '600 12px system-ui, sans-serif';
  for (const s of segs) {
    ctx.fillStyle = '#d1453b';
    ctx.beginPath();
    ctx.arc(s.x1, s.y1, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1d2330';
    ctx.fillText(String(s.seg), s.x1 + 8, s.y1 - 6);
  }
  return segs;
}

// 軌跡の下に出す一行のまとめ
export function trajectorySummary(block, pageIndex, segs) {
  const pg = pageEvents(block)[pageIndex];
  if (!pg) return '';
  const inc = segs.filter((s) => includedInSummary(s));
  const fmt = (v) => (v == null ? '–' : Math.round(v));
  const parts = [
    `区間 ${segs.length}（集計対象 ${inc.length}）`,
    `最後の移動時間の中央値 ${fmt(median(inc.map((s) => s.time_final_move_ms)))} ms`,
    `平均速度の中央値 ${fmt(median(inc.map((s) => s.speed_active_px_s)))} px/s`,
    `空振り ${segs.reduce((a, s) => a + s.miss_clicks, 0)}`
  ];
  if (pg.task === 'aim') {
    const end = block.events.find((e) => e.type === 'aim-end' && e.t > pg.t);
    if (end) parts.push(`命中 ${end.hits}・誤選択 ${end.wrong}`);
  }
  return parts.join('　');
}
