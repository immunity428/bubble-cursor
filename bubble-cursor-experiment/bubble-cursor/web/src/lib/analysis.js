// 回答点（クリックした位置）を点群とみなし、点と点のあいだの移動を区間（セグメント）ごとに数値化する。
// ブラウザでも Node（ESM）でも同じコードで動く。
//
// 区間 k : 点 P[k-1] を押した瞬間 → 点 P[k] を押した瞬間
//   点 = 回答・「次へ」・「開始」を選んだクリックで、マウスボタンを押した位置と時刻（pointerdown）
//   エイム課題では、目標に当てたクリックだけが点になる（目標以外を選んだクリックは区間内の誤選択として数える）
//
// 停止の判定: pointermove はカーソルが動いたときだけ届くので、
//   サンプルの間隔が PAUSE_MS を超えたら「その間カーソルは止まっていた」とみなす。
export const DEFAULT_PARAMS = {
  PAUSE_MS: 100,         // これより長くサンプルが来なければ停止とみなす
  SPEED_WINDOW_MS: 40,   // 瞬間速度（最大速度）を出すときの時間窓。短いほどノイズを拾う
  PRESS_MATCH_MS: 2000   // 選択イベントとそれを起こしたボタン押下を対応づける最大の時間差
};

const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
const round = (v, d = 1) => (v == null || !isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d);

// t が昇順の配列で、t > value となる最初の位置
function upperBound(arr, value) {
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] <= value) lo = mid + 1; else hi = mid;
  }
  return lo;
}

// 点列 pts[from..to] での最大速度(px/s)。停止をまたぐ区間は使わない
function peakSpeed(pts, from, to, p) {
  let best = 0;
  let k = from;
  for (let i = from + 1; i <= to; i++) {
    if (pts[i].t - pts[i - 1].t > p.PAUSE_MS) { k = i; continue; }
    while (k < i - 1 && pts[i].t - pts[k + 1].t >= p.SPEED_WINDOW_MS) k++;
    const dt = pts[i].t - pts[k].t;
    if (dt >= p.SPEED_WINDOW_MS * 0.75) best = Math.max(best, dist(pts[k], pts[i]) / dt * 1000);
  }
  return best;
}

// ターゲットまでの距離（中なら0）。バブルカーソルの IntD と同じ。円のターゲットは円として測る
function targetDistance(x, y, r) {
  if (r.shape === 'circle') {
    return Math.max(0, Math.hypot(x - (r.x + r.w / 2), y - (r.y + r.h / 2)) - Math.min(r.w, r.h) / 2);
  }
  const dx = Math.max(r.x - x, 0, x - (r.x + r.w));
  const dy = Math.max(r.y - y, 0, y - (r.y + r.h));
  return Math.hypot(dx, dy);
}

function kindOf(sel) {
  return sel ? sel.kind || 'answer' : 'start';
}

// ---------- 1ブロック（1条件）分の区間を計算 ----------
// qinfo: 質問IDから質問文などを引く表（questionIndex(session) の戻り値）。なくても動く
export function analyzeBlock(block, params, qinfo) {
  const p = { ...DEFAULT_PARAMS, ...params };
  const S = block.samples;
  const events = [...block.events].sort((a, b) => a.t - b.t);
  const downs = events.filter((e) => e.type === 'down' && e.button === 0);
  const selects = events.filter((e) => e.type === 'select');
  const pages = events.filter((e) => e.type === 'page');
  const scrolls = events.filter((e) => e.type === 'scroll' || e.type === 'wheel');

  // 選択イベントごとに、それを起こしたボタン押下（実際にマウスを押した位置）を探す
  const used = new Set();
  const points = [];
  for (const sel of selects) {
    let press = null;
    for (let i = downs.length - 1; i >= 0; i--) {
      const d = downs[i];
      if (d.t > sel.t) continue;
      if (sel.t - d.t > p.PRESS_MATCH_MS) break;
      if (!used.has(i)) { press = d; used.add(i); }
      break;
    }
    // エイム課題で目標以外を選んだクリックは点にしない（押下は「使用済み」にして空振りとは数えない）
    if (sel.kind === 'aim' && !sel.hit) continue;
    if (press) points.push({ t: press.t, x: press.x, y: press.y, sel, pressed: true });
    else {
      // 押下が見つからない（キーボード操作など）。直前のカーソル位置で代用し、印を付ける
      const i = upperBound(S.t, sel.t) - 1;
      if (i < 0) continue;
      points.push({ t: sel.t, x: S.x[i], y: S.y[i], sel, pressed: false });
    }
  }
  const missDowns = downs.filter((_, i) => !used.has(i));
  const wrongSelects = selects.filter((e) => e.kind === 'aim' && !e.hit);

  const segments = [];
  const answered = new Set();
  for (let k = 1; k < points.length; k++) {
    const P0 = points[k - 1], P1 = points[k];
    const sel = P1.sel;
    const i0 = upperBound(S.t, P0.t);
    const i1 = upperBound(S.t, P1.t); // サンプル i0..i1-1 が区間内（押した瞬間を含む）
    const pts = [{ t: P0.t, x: P0.x, y: P0.y }];
    for (let i = i0; i < i1; i++) pts.push({ t: S.t[i], x: S.x[i], y: S.y[i] });
    if (pts[pts.length - 1].t !== P1.t) pts.push({ t: P1.t, x: P1.x, y: P1.y });
    const n = pts.length;

    // 経路長・動いていた時間・停止
    let path = 0, active = 0, pauses = 0;
    for (let i = 1; i < n; i++) {
      const dt = pts[i].t - pts[i - 1].t;
      path += dist(pts[i - 1], pts[i]);
      if (dt <= p.PAUSE_MS) active += dt; else pauses++;
    }
    const T = P1.t - P0.t;

    // 最後のひと続きの動き（クリック直前に止まっていた時間は除く）
    let last = n - 1;
    while (last > 0 && dist(pts[last], pts[last - 1]) === 0) last--; // 押す瞬間の同じ座標は除く
    const dwell = P1.t - pts[last].t;
    let j = last;
    while (j > 0 && pts[j].t - pts[j - 1].t <= p.PAUSE_MS) j--;
    // j = 最後の動きの最初の点。j>0 なら pts[j-1] で止まっていた
    const rest = j > 0 ? pts[j - 1] : pts[0];
    let finalPath = j > 0 ? dist(rest, pts[j]) : 0;
    for (let i = j + 1; i <= last; i++) finalPath += dist(pts[i - 1], pts[i]);
    const finalT = last > 0 ? pts[last].t - pts[j].t : 0;
    const finalD = dist(rest, pts[last]);

    // ターゲット（ページ表示時の位置）
    const page = [...pages].reverse().find((pg) => pg.t <= sel.t) || null;
    const tgt = page && page.targets ? page.targets.find((g) => g.tid === sel.tid) : null;
    let targetW = null, targetH = null, targetD = null, ID = null, pressToTarget = null;
    if (tgt) {
      targetW = tgt.w; targetH = tgt.h;
      const c = { x: tgt.x + tgt.w / 2, y: tgt.y + tgt.h / 2 };
      targetD = dist(P0, c);
      ID = Math.log2(targetD / Math.min(tgt.w, tgt.h) + 1);
      pressToTarget = targetDistance(P1.x, P1.y, tgt);
    }

    const D = dist(P0, P1);
    // 回答の変更：単一選択は同じ質問を選び直したとき、複数選択はチェックを外したとき
    const revision = !sel.qid ? false
      : sel.qtype === 'multi' ? sel.checked === false
        : answered.has(sel.qid);
    if (sel.qid) answered.add(sel.qid);
    const q = sel.qid && qinfo ? qinfo.get(sel.qid) : null;

    const task = sel.task || 'survey';
    segments.push({
      condition: block.condition,
      block: block.index,
      task,
      practice: !!sel.practice,
      seg: segments.length + 1,
      page: sel.page,
      from: P0.sel ? P0.sel.tid : 'start',
      to: sel.tid,
      type: `${kindOf(P0.sel)}->${kindOf(sel)}`,
      qid: sel.qid || '',
      value: sel.value == null ? '' : sel.value,
      set: block.questionSet || '',
      qtype: sel.qtype || (q ? q.type : ''),
      question: q ? q.text : '',
      label: sel.label == null ? '' : sel.label,
      via: sel.via,
      revision,
      x0: round(P0.x), y0: round(P0.y), x1: round(P1.x), y1: round(P1.y),
      // 時間 (ms)
      time_total_ms: round(T),
      time_active_ms: round(active),
      time_idle_ms: round(T - active),
      time_final_move_ms: round(finalT),
      dwell_before_press_ms: round(dwell),
      // 距離 (px)
      dist_straight_px: round(D),
      path_px: round(path),
      path_final_px: round(finalPath),
      dist_final_straight_px: round(finalD),
      straightness: path > 0 ? round(D / path, 3) : null,
      // 速度 (px/s)
      speed_overall_px_s: T > 0 ? round(path / T * 1000) : null,
      speed_active_px_s: active > 0 ? round(path / active * 1000) : null,
      speed_final_px_s: finalT > 0 ? round(finalPath / finalT * 1000) : null,
      speed_peak_px_s: round(peakSpeed(pts, 0, last, p)),
      pauses,
      samples: n - 2 >= 0 ? i1 - i0 : 0,
      // ターゲットとの関係
      target_w: targetW, target_h: targetH,
      target_dist_px: round(targetD),
      fitts_id: round(ID, 3),
      press_to_target_px: round(pressToTarget),
      throughput_bps: task === 'aim' && ID != null && T > 0 ? round(ID / (T / 1000), 3) : null,
      miss_clicks: missDowns.filter((d) => d.t > P0.t && d.t < P1.t).length,
      wrong_selections: wrongSelects.filter((e) => e.t > P0.t && e.t < sel.t).length,
      scrolled: scrolls.some((s) => s.t > P0.t && s.t <= P1.t),
      press_found: P1.pressed
    });
  }
  return segments;
}

export function analyzeSession(session, params) {
  const out = [];
  const qinfo = questionIndex(session);
  for (const b of session.blocks) {
    for (const s of analyzeBlock(b, params, qinfo)) {
      // included = 条件別まとめに使う区間か（練習・「開始」への移動・スクロールを含む区間は false）
      out.push({ participant: session.meta.participantId, ...s, included: includedInSummary(s) });
    }
  }
  return out;
}

// ---------- 条件ごとのまとめ ----------
const median = (a) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

const SUMMARY_FIELDS = [
  'time_total_ms', 'time_active_ms', 'time_final_move_ms', 'path_px',
  'speed_active_px_s', 'speed_final_px_s', 'speed_peak_px_s', 'straightness', 'press_to_target_px',
  'throughput_bps'
];

// エイム課題の1ラウンドごとの成績（制限時間内の命中数など）をイベントから数える
export function aimRounds(session) {
  const rows = [];
  for (const b of session.blocks) {
    const ev = [...b.events].sort((a, c) => a.t - c.t);
    for (const st of ev.filter((e) => e.type === 'aim-start')) {
      const end = ev.find((e) => e.type === 'aim-end' && e.t >= st.t);
      const t1 = end ? end.t : Infinity;
      const sel = ev.filter((e) => e.type === 'select' && e.kind === 'aim' && e.t >= st.t && e.t <= t1);
      const downs = ev.filter((e) => e.type === 'down' && e.button === 0 && e.t >= st.t && e.t <= t1).length;
      const hits = sel.filter((e) => e.hit).length;
      const wrong = sel.length - hits;
      const miss = Math.max(0, downs - sel.length);
      const dur = end ? (end.t - st.t) / 1000 : null;
      rows.push({
        participant: session.meta.participantId, condition: b.condition, block: b.index,
        set: b.questionSet || '',
        practice: !!st.practice, seconds: st.seconds, targets: st.targets, size_px: st.size, seed: st.seed,
        hits, wrong_selections: wrong, miss_clicks: miss, clicks: downs,
        accuracy: downs ? round(hits / downs, 3) : null,
        hits_per_s: dur ? round(hits / dur, 3) : null
      });
    }
  }
  return rows;
}

// 課題（アンケート／エイム）× 条件ごとに平均と中央値を出す。次の区間は除く
//  - 練習の区間
//  - 説明画面の「開始」ボタンへ向かう区間（説明画面では両条件ともバブルが無効なので比較にならない）
//  - エイム課題の最初の1回（画面が切り替わった直後で、出発点が開始ボタンになるため）
//  - スクロールを含む区間（画面上の位置と回答の位置がずれるため）
export function includedInSummary(s, opts) {
  const o = { includePractice: false, ...opts };
  if (!o.includePractice && s.practice) return false;
  if (s.type.endsWith('->start')) return false;
  if (s.type === 'start->aim') return false;
  if (s.scrolled) return false;
  return true;
}

// session を渡すと、エイム課題の命中数なども行に加える
export function summarize(segments, opts, session) {
  const rounds = session ? aimRounds(session).filter((r) => !r.practice) : [];
  const groups = new Map();
  for (const s of segments) {
    if (!includedInSummary(s, opts)) continue;
    const key = `${s.participant}\t${s.task}\t${s.condition}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s);
  }
  const rows = [];
  for (const [key, list] of groups) {
    const [participant, task, condition] = key.split('\t');
    const aim = task === 'aim' ? rounds.find((r) => r.participant === participant && r.condition === condition) : null;
    const row = {
      participant, task, condition, n_segments: list.length,
      n_bubble_assisted: list.filter((s) => s.via === 'bubble').length,
      miss_clicks: list.reduce((a, s) => a + s.miss_clicks, 0),
      wrong_selections: list.reduce((a, s) => a + (s.wrong_selections || 0), 0),
      revisions: list.filter((s) => s.revision).length,
      total_time_s: round(list.reduce((a, s) => a + s.time_total_ms, 0) / 1000, 2),
      aim_hits: aim ? aim.hits : null,
      aim_accuracy: aim ? aim.accuracy : null,
      aim_hits_per_s: aim ? aim.hits_per_s : null
    };
    for (const f of SUMMARY_FIELDS) {
      const vals = list.map((s) => s[f]).filter((v) => v != null);
      row[`${f}_mean`] = round(mean(vals), 3);
      row[`${f}_median`] = round(median(vals), 3);
    }
    rows.push(row);
  }
  return rows;
}

// 行ごとに列がちがっても、出てきた順にすべての列を並べる
export function toCSV(rows) {
  if (!rows.length) return '';
  const seen = new Set();
  for (const r of rows) for (const k of Object.keys(r)) seen.add(k);
  const cols = [...seen];
  const esc = (v) => {
    if (v == null) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n') + '\n';
}

// ---------- 質問と回答 ----------
// 記録に入っている質問の定義（meta.survey）から、質問ID → { text, type, set, page, parent, options } の表を作る。
// マトリクスは行ごとに1つの質問として扱い、text は「親の質問文：行の文」にする。
export function questionIndex(session) {
  const map = new Map();
  const survey = session && session.meta && session.meta.survey;
  if (!survey) return map;
  const add = (q, set, page, practice) => {
    if (q.type === 'matrix') {
      for (const row of q.rows) {
        map.set(row.id, { text: `${q.text}：${row.text}`, type: 'matrix', set, page, parent: q.id, options: q.options, practice });
      }
    } else {
      map.set(q.id, { text: q.text, type: q.type, set, page, parent: '', options: q.options, practice });
    }
  };
  for (const pg of survey.practice || []) for (const q of pg.questions) add(q, '', pg.id, true);
  for (const [set, def] of Object.entries(survey.sets || {})) {
    for (const pg of def.pages) for (const q of pg.questions) add(q, set, pg.id, false);
  }
  return map;
}

// 回答の一覧：ブロック × 質問ごとに1行。質問文・選んだ選択肢の文・変更回数・回答にかかった時間を含む
export function answersTable(session) {
  const qinfo = questionIndex(session);
  const rows = [];
  for (const b of session.blocks) {
    const ev = [...b.events].sort((a, c) => a.t - c.t);
    const pageShown = new Map();
    for (const e of ev) if (e.type === 'page' && !pageShown.has(e.page)) pageShown.set(e.page, e.t);
    const byQ = new Map();
    for (const e of ev) {
      if (e.type !== 'select' || e.kind !== 'answer') continue;
      if (!byQ.has(e.qid)) byQ.set(e.qid, []);
      byQ.get(e.qid).push(e);
    }
    for (const [qid, list] of byQ) {
      const q = qinfo.get(qid);
      const first = list[0], last = list[list.length - 1];
      const final = b.answers && qid in b.answers ? b.answers[qid] : last.value;
      const values = Array.isArray(final) ? final : final == null ? [] : [final];
      const opts = q ? q.options : null;
      const labelOf = (v) => (opts && opts[v - 1] != null ? opts[v - 1] : (list.find((e) => e.value === v) || {}).label || '');
      const shown = pageShown.get(first.page);
      rows.push({
        participant: session.meta.participantId,
        condition: b.condition,
        block: b.index + 1,
        set: b.questionSet || '',
        practice: !!first.practice,
        page: first.page,
        qid,
        parent: q ? q.parent : '',
        qtype: first.qtype || (q ? q.type : ''),
        question: q ? q.text : '',
        value: values.join(';'),
        label: values.map(labelOf).join(';'),
        selections: list.length,
        changes: first.qtype === 'multi' ? list.filter((e) => e.checked === false).length : list.length - 1,
        first_select_ms: shown == null ? null : round(first.t - shown),
        last_select_ms: shown == null ? null : round(last.t - shown),
        via_bubble: list.filter((e) => e.via === 'bubble').length
      });
    }
  }
  return rows;
}
