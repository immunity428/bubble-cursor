// 比較ページの計算（画面とは切り離した純粋な関数）
import { median, wilcoxon } from '../lib/stats.js';

export const COND_LABEL = { off: 'バブルなし', on: 'バブルあり' };
export const TASK_LABEL = { survey: 'アンケート', aim: 'エイム', aim_round: 'エイム成績' };

// 比べる軸：バブルの有無／実施した順番（順序効果）／質問セット（セットの差）
export const AXES = {
  condition: { groups: ['off', 'on'], label: { off: 'バブルなし', on: 'バブルあり' }, of: (r) => r.condition },
  order: { groups: ['1', '2'], label: { 1: '1回目', 2: '2回目' }, of: (r) => String(r.block + 1) },
  set: { groups: ['A', 'B'], label: { A: 'セットA', B: 'セットB' }, of: (r) => r.set }
};

// agg: 参加者ごとの代表値の求め方（区間の中央値 / 合計 / true の数 / ラウンドの値そのまま）
const SEG = ['survey', 'aim'];
export const METRICS = [
  { key: 'time_final_move_ms', label: '最後の移動時間', unit: 'ms', agg: 'median', tasks: SEG },
  { key: 'time_total_ms', label: '区間時間', unit: 'ms', agg: 'median', tasks: SEG },
  { key: 'time_active_ms', label: '動いていた時間', unit: 'ms', agg: 'median', tasks: SEG },
  { key: 'speed_active_px_s', label: '平均速度', unit: 'px/s', agg: 'median', tasks: SEG },
  { key: 'speed_final_px_s', label: '最後の移動の速度', unit: 'px/s', agg: 'median', tasks: SEG },
  { key: 'speed_peak_px_s', label: '最大速度', unit: 'px/s', agg: 'median', tasks: SEG },
  { key: 'path_px', label: '経路長', unit: 'px', agg: 'median', tasks: SEG },
  { key: 'straightness', label: '直進度', unit: '', agg: 'median', tasks: SEG },
  { key: 'press_to_target_px', label: '押下位置→ターゲット', unit: 'px', agg: 'median', tasks: SEG },
  { key: 'throughput_bps', label: 'スループット', unit: 'bit/s', agg: 'median', tasks: ['aim'] },
  { key: 'miss_clicks', label: '空振り（合計）', unit: '回', agg: 'sum', tasks: SEG },
  { key: 'wrong_selections', label: '誤選択（合計）', unit: '回', agg: 'sum', tasks: ['aim'] },
  { key: 'revision', label: '回答の変更（合計）', unit: '回', agg: 'countTrue', tasks: ['survey'] },
  { key: 'hits', label: '命中数', unit: '回', agg: 'value', tasks: ['aim_round'] },
  { key: 'hits_per_s', label: '1秒あたりの命中', unit: '回/s', agg: 'value', tasks: ['aim_round'] },
  { key: 'accuracy', label: '命中率', unit: '', agg: 'value', tasks: ['aim_round'] },
  { key: 'wrong_selections', label: '誤選択', unit: '回', agg: 'value', tasks: ['aim_round'] },
  { key: 'miss_clicks', label: '空振り', unit: '回', agg: 'value', tasks: ['aim_round'] }
];
export const metricsFor = (task) => METRICS.filter((m) => m.tasks.includes(task));

export function fmt(v, unit) {
  if (v == null || !isFinite(v)) return '–';
  if (unit === '' || unit === 'bit/s' || unit === '回/s') return v.toFixed(Math.abs(v) >= 10 ? 1 : 3);
  if (Number.isInteger(v)) return String(v);
  const a = Math.abs(v);
  return v.toFixed(a >= 100 ? 0 : a >= 10 ? 1 : 2);
}
export const fmtP = (p) => (p == null ? '–' : p < 0.001 ? '<0.001' : p.toFixed(3));

function aggregate(list, m) {
  if (m.agg === 'sum') return list.length ? list.reduce((a, s) => a + (Number(s[m.key]) || 0), 0) : null;
  if (m.agg === 'countTrue') return list.length ? list.filter((s) => s[m.key] === true).length : null;
  return median(list.map((s) => s[m.key]));
}

// 参加者 × グループ（なし/あり、1回目/2回目、A/B）ごとの代表値
export function participantValues(files, segments, rounds, task, axisKey) {
  const axis = AXES[axisKey];
  const ms = metricsFor(task);
  const rows = [];
  for (const f of files) {
    if (!f.enabled) continue;
    for (const g of axis.groups) {
      const row = { sid: f.id, participant: f.label, group: g, values: {} };
      if (task === 'aim_round') {
        const r = rounds.find((x) => x.sid === f.id && axis.of(x) === g);
        row.n = r ? 1 : 0;
        if (r) { row.block = r.block; row.condition = r.condition; row.set = r.set; }
        for (const m of ms) row.values[m.key] = r ? r[m.key] : null;
      } else {
        const list = segments.filter((s) => s.sid === f.id && s.task === task && s.included && axis.of(s) === g);
        row.n = list.length;
        if (list.length) { row.block = list[0].block; row.condition = list[0].condition; row.set = list[0].set; }
        for (const m of ms) row.values[m.key] = list.length ? aggregate(list, m) : null;
      }
      rows.push(row);
    }
  }
  return rows;
}

function pairsFor(rows, axisKey, key) {
  const [ga, gb] = AXES[axisKey].groups;
  const bySid = new Map();
  for (const r of rows) {
    if (!bySid.has(r.sid)) bySid.set(r.sid, { participant: r.participant });
    bySid.get(r.sid)[r.group] = r.values[key];
  }
  const out = [];
  for (const [sid, v] of bySid) {
    if (v[ga] != null && v[gb] != null && isFinite(v[ga]) && isFinite(v[gb])) out.push({ sid, participant: v.participant, a: v[ga], b: v[gb] });
  }
  return out;
}

// 指標ごとに、参加者の対で Wilcoxon 符号順位検定（対応あり・両側）
export function comparison(pvRows, task, axisKey) {
  return metricsFor(task).map((m) => {
    const pairs = pairsFor(pvRows, axisKey, m.key);
    const t = wilcoxon(pairs.map((p) => p.a), pairs.map((p) => p.b));
    return {
      m, pairs, n: pairs.length,
      a: median(pairs.map((p) => p.a)),
      b: median(pairs.map((p) => p.b)),
      diff: median(pairs.map((p) => p.b - p.a)),
      W: t.W, p: t.p, r: t.r, method: t.method
    };
  });
}

// 比較の前に確認したいこと
export function checkFiles(files) {
  const on = files.filter((f) => f.enabled);
  const issues = [];
  const differs = (label, fn) => {
    const vals = new Map();
    for (const f of on) {
      const v = fn(f);
      if (!vals.has(v)) vals.set(v, []);
      vals.get(v).push(f.label);
    }
    if (vals.size > 1) issues.push(`${label}が参加者によって違います：${[...vals].map(([v, who]) => `${v}（${who.join(', ')}）`).join(' ／ ')}`);
  };
  differs('画面の大きさ', (f) => { const v = f.session.blocks[0] && f.session.blocks[0].viewport; return v ? `${v.w}×${v.h}` : '不明'; });
  differs('バブルの最大半径', (f) => (f.session.meta.maxRadius ? `${f.session.meta.maxRadius}px` : '上限なし'));
  differs('エイム課題の設定', (f) => {
    const a = f.session.meta.aim;
    return a ? `${a.seconds}秒・${a.targets}個・${a.size}px・種${a.seed}` : 'なし';
  });
  // 質問の中身（v2 以降は記録に入っている）。旧形式は質問セットがない
  differs('アンケートの版', (f) => (f.session.meta.survey ? `質問セットあり（v${f.session.meta.version}）` : '旧形式（同じ質問を2回）'));
  const defs = new Map();
  for (const f of on) {
    if (!f.session.meta.survey) continue;
    const key = JSON.stringify(f.session.meta.survey);
    if (!defs.has(key)) defs.set(key, []);
    defs.get(key).push(f.label);
  }
  if (defs.size > 1) issues.push(`質問の中身が参加者によって違います（質問を書き換えたあとの記録が混ざっています）：${[...defs.values()].map((w) => w.join(', ')).join(' ／ ')}`);

  const count = (fn) => { const m = new Map(); for (const f of on) { const k = fn(f); m.set(k, (m.get(k) || 0) + 1); } return m; };
  const offFirst = on.filter((f) => (f.session.meta.order || [])[0] === 'off').length;
  const onFirst = on.length - offFirst;
  if (on.length >= 2 && offFirst !== onFirst) {
    issues.push(`条件の順番がそろっていません（なし→あり ${offFirst}人、あり→なし ${onFirst}人）。順序効果を打ち消すには同数にします。`);
  }
  // 4人以上いるときだけ、順番 × セットの4通りがそろっているかを見る
  const v2 = on.filter((f) => f.session.meta.sets);
  if (v2.length >= 4) {
    const combo = count((f) => (f.session.meta.sets ? f.session.meta.order.map((c, i) => `${c === 'off' ? 'なし' : 'あり'}${f.session.meta.sets[i]}`).join('→') : null));
    combo.delete(null);
    if (combo.size < 4 || new Set(combo.values()).size > 1) {
      issues.push(`条件の順番と質問セットの組み合わせが偏っています（${[...combo].map(([k, n]) => `${k} ${n}人`).join('、')}）。4通りを同じ人数にすると、順番とセットの影響を打ち消せます。`);
    }
  }
  const devUsed = on.filter((f) => f.session.meta.devMode || f.session.meta.devModeUsed ||
    f.session.blocks.some((b) => b.events.some((e) => e.type === 'devmode' && e.on)));
  if (devUsed.length) issues.push(`開発者モードを使った記録が含まれています（表示が見えていた可能性があります）：${devUsed.map((f) => f.label).join(', ')}`);
  const partial = on.filter((f) => f.session.blocks.length < (f.session.meta.order || []).length);
  if (partial.length) issues.push(`途中で終わっているデータがあります：${partial.map((f) => f.label).join(', ')}`);
  return issues;
}
