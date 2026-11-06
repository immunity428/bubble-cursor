// 実験アプリで保存した JSON を複数読み込み、参加者ごとに対にして条件を比較する
(() => {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const BACKUP_KEY = 'bc-experiment-backups';

  // 比べる軸：バブルの有無、または実施した順番（順序効果の確認用）
  const AXES = {
    condition: {
      groups: ['off', 'on'],
      label: { off: 'バブルなし', on: 'バブルあり' },
      of: (block, condition) => condition
    },
    order: {
      groups: ['1', '2'],
      label: { 1: '1回目', 2: '2回目' },
      of: (block) => String(block + 1)
    }
  };
  const TASK_LABEL = { survey: 'アンケート', aim: 'エイム', aim_round: 'エイム成績' };
  const COND_LABEL = { off: 'バブルなし', on: 'バブルあり' };

  // agg: 参加者ごとの代表値の求め方（区間の中央値 / 合計 / true の数 / ラウンドの値そのまま）
  const SEG = ['survey', 'aim'];
  const METRICS = [
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
  const metricsFor = (task) => METRICS.filter((m) => m.tasks.includes(task));

  const state = {
    files: [],          // { id, name, label, session, enabled }
    params: { ...Analysis.DEFAULT_PARAMS },
    segments: [],
    rounds: [],
    task: 'survey',
    axis: 'condition',
    metric: { survey: 'time_final_move_ms', aim: 'time_final_move_ms', aim_round: 'hits' }
  };
  let nextId = 1;

  // ---------- 小物 ----------
  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'text') node.textContent = v;
      else if (k === 'class') node.className = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? '' : v);
    }
    for (const c of [].concat(children || [])) {
      if (c == null) continue;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return node;
  }

  const SVGNS = 'http://www.w3.org/2000/svg';
  function svg(tag, attrs, children) {
    const node = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs || {})) if (v != null) node.setAttribute(k, v);
    for (const c of [].concat(children || [])) if (c != null) node.appendChild(c);
    return node;
  }

  function fmt(v, unit) {
    if (v == null || !isFinite(v)) return '–';
    if (unit === '' || unit === 'bit/s' || unit === '回/s') return v.toFixed(Math.abs(v) >= 10 ? 1 : 3);
    if (Number.isInteger(v)) return String(v);
    const a = Math.abs(v);
    return v.toFixed(a >= 100 ? 0 : a >= 10 ? 1 : 2);
  }
  const fmtP = (p) => (p == null ? '–' : p < 0.001 ? '<0.001' : p.toFixed(3));

  function download(name, text) {
    const blob = new Blob(['﻿' + text], { type: 'text/csv' });
    const a = el('a', { href: URL.createObjectURL(blob), download: name });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function notify(message) {
    const box = el('div', { class: 'warn' }, [message, ' ',
      el('button', { class: 'x', type: 'button', 'aria-label': '閉じる', text: '×', onclick: (e) => e.target.parentElement.remove() })]);
    $('#warnings').prepend(box);
  }

  // ---------- 読み込み ----------
  function isSession(obj) {
    return obj && obj.meta && Array.isArray(obj.blocks) && obj.meta.participantId != null;
  }

  function addSessions(items) {
    let added = 0;
    for (const { name, session } of items) {
      const dup = state.files.find((f) =>
        f.session.meta.participantId === session.meta.participantId && f.session.meta.startedAt === session.meta.startedAt);
      if (dup) continue;
      const pid = String(session.meta.participantId);
      const same = state.files.filter((f) => String(f.session.meta.participantId) === pid).length;
      state.files.push({ id: nextId++, name, session, enabled: true, label: same ? `${pid} (${same + 1})` : pid });
      added++;
    }
    state.files.sort((a, b) => a.label.localeCompare(b.label, 'ja', { numeric: true }));
    if (added) update();
    return added;
  }

  async function readFiles(fileList) {
    const items = [];
    const bad = [];
    for (const file of fileList) {
      try {
        const obj = JSON.parse(await file.text());
        if (isSession(obj)) items.push({ name: file.name, session: obj });
        else bad.push(file.name);
      } catch (_) {
        bad.push(file.name);
      }
    }
    const added = addSessions(items);
    if (bad.length) notify(`実験データとして読めなかったファイル: ${bad.join(', ')}`);
    if (items.length && !added) notify('同じデータはすでに読み込まれています。');
  }

  $('#file-input').addEventListener('change', (e) => { readFiles([...e.target.files]); e.target.value = ''; });

  $('#load-backup').addEventListener('click', () => {
    let list = [];
    try { list = JSON.parse(localStorage.getItem(BACKUP_KEY) || '[]'); } catch (_) { /* noop */ }
    const items = list.filter((b) => isSession(b.session)).map((b) => ({ name: `${b.key}（ブラウザ内）`, session: b.session }));
    if (!items.length) {
      notify('このブラウザには実験アプリの記録が見つかりませんでした（実験アプリと同じ場所から開いたときだけ読めます）。');
      return;
    }
    const added = addSessions(items);
    if (!added) notify('ブラウザ内の記録はすべて読み込み済みです。');
  });

  $('#clear-all').addEventListener('click', () => {
    if (!confirm('読み込んだデータをすべて外しますか？（ファイルは消えません）')) return;
    state.files = [];
    update();
  });

  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; $('#drop-overlay').hidden = false; });
  window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('#drop-overlay').hidden = true; } });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    $('#drop-overlay').hidden = true;
    if (e.dataTransfer && e.dataTransfer.files.length) readFiles([...e.dataTransfer.files]);
  });

  // ---------- 計算 ----------
  function recompute() {
    state.segments = [];
    state.rounds = [];
    for (const f of state.files) {
      if (!f.enabled) continue;
      for (const s of Analysis.analyzeSession(f.session, state.params)) {
        state.segments.push({ ...s, participant: f.label, sid: f.id });
      }
      for (const r of Analysis.aimRounds(f.session)) {
        if (!r.practice) state.rounds.push({ ...r, participant: f.label, sid: f.id });
      }
    }
  }

  function aggregate(list, m) {
    if (m.agg === 'sum') return list.length ? list.reduce((a, s) => a + (Number(s[m.key]) || 0), 0) : null;
    if (m.agg === 'countTrue') return list.length ? list.filter((s) => s[m.key] === true).length : null;
    return Stats.median(list.map((s) => s[m.key]));
  }

  // 参加者 × グループ（なし/あり、または1回目/2回目）ごとの代表値
  function participantValues(task, axisKey) {
    const axis = AXES[axisKey];
    const ms = metricsFor(task);
    const rows = [];
    for (const f of state.files) {
      if (!f.enabled) continue;
      for (const g of axis.groups) {
        const row = { sid: f.id, participant: f.label, group: g, values: {} };
        if (task === 'aim_round') {
          const r = state.rounds.find((x) => x.sid === f.id && axis.of(x.block, x.condition) === g);
          row.n = r ? 1 : 0;
          if (r) { row.block = r.block; row.condition = r.condition; }
          for (const m of ms) row.values[m.key] = r ? r[m.key] : null;
        } else {
          const list = state.segments.filter((s) =>
            s.sid === f.id && s.task === task && s.included && axis.of(s.block, s.condition) === g);
          row.n = list.length;
          if (list.length) { row.block = list[0].block; row.condition = list[0].condition; }
          for (const m of ms) row.values[m.key] = list.length ? aggregate(list, m) : null;
        }
        rows.push(row);
      }
    }
    return rows;
  }

  function pairsFor(rows, axisKey, key) {
    const [ga, gb] = AXES[axisKey].groups;
    const out = [];
    const bySid = new Map();
    for (const r of rows) {
      if (!bySid.has(r.sid)) bySid.set(r.sid, { participant: r.participant });
      bySid.get(r.sid)[r.group] = r.values[key];
    }
    for (const [sid, v] of bySid) {
      if (v[ga] != null && v[gb] != null && isFinite(v[ga]) && isFinite(v[gb])) {
        out.push({ sid, participant: v.participant, a: v[ga], b: v[gb] });
      }
    }
    return out;
  }

  function comparison(task, axisKey) {
    const rows = participantValues(task, axisKey);
    return metricsFor(task).map((m) => {
      const pairs = pairsFor(rows, axisKey, m.key);
      const t = Stats.wilcoxon(pairs.map((p) => p.a), pairs.map((p) => p.b));
      return {
        m, pairs,
        n: pairs.length,
        a: Stats.median(pairs.map((p) => p.a)),
        b: Stats.median(pairs.map((p) => p.b)),
        diff: Stats.median(pairs.map((p) => p.b - p.a)),
        bBetter: pairs.filter((p) => p.b !== p.a).length,
        W: t.W, p: t.p, r: t.r, method: t.method, nNonZero: t.n
      };
    });
  }

  // ---------- 1. データ一覧と注意 ----------
  function blockOf(session, cond) {
    return session.blocks.find((b) => b.condition === cond);
  }

  function renderSessions() {
    const head = el('tr', {}, ['', '参加者', '実施日時', '順番', '区間（アンケート/エイム）', 'エイム命中 なし/あり',
      '画面', '最大半径', 'エイム設定', 'ファイル', ''].map((h, i) => el('th', { class: i <= 4 || i >= 9 ? 'l' : null, text: h })));
    const body = state.files.map((f) => {
      const m = f.session.meta;
      const segs = state.segments.filter((s) => s.sid === f.id && s.included);
      const hits = (cond) => {
        const r = state.rounds.find((x) => x.sid === f.id && x.condition === cond);
        return r ? r.hits : '–';
      };
      const vp = f.session.blocks[0] && f.session.blocks[0].viewport;
      const aim = m.aim ? `${m.aim.seconds}秒・${m.aim.targets}個・${m.aim.size}px・種${m.aim.seed}` : '（なし）';
      const done = `${f.session.blocks.length}/${(m.order || []).length}`;
      const cb = el('input', { type: 'checkbox', checked: f.enabled, 'aria-label': `${f.label} を集計に含める`,
        onchange: (e) => { f.enabled = e.target.checked; update(); } });
      const remove = el('button', { class: 'x', type: 'button', title: '外す', 'aria-label': `${f.label} を外す`, text: '×',
        onclick: () => { state.files = state.files.filter((x) => x !== f); update(); } });
      return el('tr', {}, [
        el('td', { class: 'l' }, [cb]),
        el('td', { class: 'l', text: f.label }),
        el('td', { class: 'l', text: m.startedAt ? new Date(m.startedAt).toLocaleString('ja-JP') : '–' }),
        el('td', { class: 'l', text: (m.order || []).map((c) => (c === 'off' ? 'なし' : 'あり')).join('→') + (done !== '2/2' ? `（${done}）` : '') }),
        el('td', { class: 'l', text: f.enabled
          ? `${segs.filter((s) => s.task === 'survey').length} / ${segs.filter((s) => s.task === 'aim').length}` : '–' }),
        el('td', { text: f.enabled ? `${hits('off')} / ${hits('on')}` : '–' }),
        el('td', { text: vp ? `${vp.w}×${vp.h}` : '–' }),
        el('td', { text: m.maxRadius ? `${m.maxRadius}px` : '上限なし' }),
        el('td', { text: aim }),
        el('td', { class: 'l dim', text: f.name }),
        el('td', {}, [remove])
      ]);
    });
    $('#session-table').replaceChildren(el('thead', {}, [head]), el('tbody', {}, body));
  }

  function renderWarnings() {
    const on = state.files.filter((f) => f.enabled);
    const issues = [];
    const differs = (label, fn) => {
      const vals = new Map();
      for (const f of on) {
        const v = fn(f);
        if (!vals.has(v)) vals.set(v, []);
        vals.get(v).push(f.label);
      }
      if (vals.size > 1) {
        issues.push(`${label}が参加者によって違います：` +
          [...vals].map(([v, who]) => `${v}（${who.join(', ')}）`).join(' ／ '));
      }
    };
    differs('画面の大きさ', (f) => { const v = f.session.blocks[0] && f.session.blocks[0].viewport; return v ? `${v.w}×${v.h}` : '不明'; });
    differs('バブルの最大半径', (f) => (f.session.meta.maxRadius ? `${f.session.meta.maxRadius}px` : '上限なし'));
    differs('エイム課題の設定', (f) => {
      const a = f.session.meta.aim;
      return a ? `${a.seconds}秒・${a.targets}個・${a.size}px・種${a.seed}` : 'なし';
    });
    differs('アンケートのページ構成', (f) => {
      const b = f.session.blocks[0];
      return b ? b.events.filter((e) => e.type === 'page' && !e.practice && e.task !== 'aim').map((e) => e.page).join(',') : '';
    });
    const offFirst = on.filter((f) => (f.session.meta.order || [])[0] === 'off').length;
    const onFirst = on.length - offFirst;
    if (on.length >= 2 && offFirst !== onFirst) {
      issues.push(`条件の順番がそろっていません（なし→あり ${offFirst}人、あり→なし ${onFirst}人）。順序効果を打ち消すには同数にします。`);
    }
    const devUsed = on.filter((f) => f.session.meta.devMode || f.session.meta.devModeUsed ||
      f.session.blocks.some((b) => b.events.some((e) => e.type === 'devmode' && e.on)));
    if (devUsed.length) {
      issues.push(`開発者モードを使った記録が含まれています（表示が見えていた可能性があります）：${devUsed.map((f) => f.label).join(', ')}`);
    }
    const partial = on.filter((f) => f.session.blocks.length < (f.session.meta.order || []).length);
    if (partial.length) issues.push(`途中で終わっているデータがあります：${partial.map((f) => f.label).join(', ')}`);

    const box = $('#warnings');
    box.querySelectorAll('.warn.auto').forEach((n) => n.remove());
    if (issues.length) {
      box.appendChild(el('div', { class: 'warn auto' }, [
        '比較の前に確認してください', el('ul', {}, issues.map((t) => el('li', { text: t })))
      ]));
    }
  }

  // ---------- 2. 比較 ----------
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

  function tickLabel(v, step) {
    const d = step >= 1 ? 0 : Math.min(3, Math.ceil(-Math.log10(step)));
    return v.toFixed(d);
  }

  function renderPaired(row) {
    const box = $('#paired-chart');
    const axis = AXES[state.axis];
    const [ga, gb] = axis.groups;
    $('#paired-title').textContent = `${row.m.label}${row.m.unit ? `（${row.m.unit}）` : ''}`;
    if (!row.pairs.length) {
      box.replaceChildren(el('p', { class: 'note', text: '両方のグループに値がある参加者がいません。' }));
      return;
    }
    const W = 360, H = 300, L = 52, R = 16, T = 14, B = 36;
    const vals = row.pairs.flatMap((p) => [p.a, p.b]);
    const { lo, hi, ticks, step } = niceTicks(Math.min(...vals), Math.max(...vals));
    const y = (v) => T + (H - T - B) * (1 - (v - lo) / (hi - lo));
    const xa = L + (W - L - R) * 0.28, xb = L + (W - L - R) * 0.72;
    const g = [];
    for (const t of ticks) {
      g.push(svg('line', { x1: L, x2: W - R, y1: y(t), y2: y(t), stroke: '#eceff4' }));
      g.push(svg('text', { x: L - 6, y: y(t) + 4, 'text-anchor': 'end' }, [document.createTextNode(tickLabel(t, step))]));
    }
    g.push(svg('line', { x1: L, x2: L, y1: T, y2: H - B, stroke: '#c5ccd8' }));
    for (const p of row.pairs) {
      const better = p.b - p.a;
      g.push(svg('line', { x1: xa, x2: xb, y1: y(p.a), y2: y(p.b), stroke: '#b6bfcf', 'stroke-width': 1.5 }, [
        svg('title', {}, [document.createTextNode(`${p.participant}: ${fmt(p.a, row.m.unit)} → ${fmt(p.b, row.m.unit)}（差 ${fmt(better, row.m.unit)}）`)])
      ]));
    }
    for (const [x, key, color] of [[xa, 'a', 'var(--c-a)'], [xb, 'b', 'var(--c-b)']]) {
      for (const p of row.pairs) {
        g.push(svg('circle', { cx: x, cy: y(p[key]), r: 4.5, fill: color, stroke: '#fff', 'stroke-width': 1.5 }, [
          svg('title', {}, [document.createTextNode(`${p.participant}: ${fmt(p[key], row.m.unit)}`)])
        ]));
      }
      const med = Stats.median(row.pairs.map((p) => p[key]));
      g.push(svg('line', { x1: x - 22, x2: x + 22, y1: y(med), y2: y(med), stroke: 'var(--ink)', 'stroke-width': 3, 'stroke-linecap': 'round' }));
    }
    g.push(svg('text', { x: xa, y: H - 12, 'text-anchor': 'middle', 'font-weight': 600 }, [document.createTextNode(axis.label[ga])]));
    g.push(svg('text', { x: xb, y: H - 12, 'text-anchor': 'middle', 'font-weight': 600 }, [document.createTextNode(axis.label[gb])]));
    box.replaceChildren(svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `${row.m.label} の参加者ごとの比較` }, g));
  }

  let lastComparison = [];

  function renderCompare() {
    const axis = AXES[state.axis];
    const [ga, gb] = axis.groups;
    const rows = comparison(state.task, state.axis);
    lastComparison = rows;
    if (!rows.find((r) => r.m.key === state.metric[state.task])) state.metric[state.task] = rows[0].m.key;
    const head = el('tr', {}, [
      el('th', { class: 'l', text: '指標' }), el('th', { text: '人数' }),
      el('th', { text: axis.label[ga] }), el('th', { text: axis.label[gb] }),
      el('th', { text: `差（${axis.label[gb].replace('バブル', '')} − ${axis.label[ga].replace('バブル', '')}）` }),
      el('th', { text: 'W' }), el('th', { text: 'p' }), el('th', { text: '効果量 r' })
    ]);
    const body = rows.map((r) => el('tr', {
      class: r.m.key === state.metric[state.task] ? 'sel' : null,
      onclick: () => { state.metric[state.task] = r.m.key; renderCompare(); }
    }, [
      el('td', { class: 'l', text: `${r.m.label}${r.m.unit ? `（${r.m.unit}）` : ''}` }),
      el('td', { text: String(r.n) }),
      el('td', { text: fmt(r.a, r.m.unit) }),
      el('td', { text: fmt(r.b, r.m.unit) }),
      el('td', { text: r.diff == null ? '–' : (r.diff > 0 ? '+' : '') + fmt(r.diff, r.m.unit) }),
      el('td', { text: r.W == null ? '–' : fmt(r.W) }),
      el('td', { class: r.p != null && r.p < 0.05 ? 'sig' : null,
        text: r.p == null ? '–' : fmtP(r.p) + (r.p < 0.05 ? ' *' : ''),
        title: r.method === 'exact' ? '正確な分布で計算' : r.method === 'normal' ? '正規近似で計算' : null }),
      el('td', { text: r.r == null ? '–' : r.r.toFixed(2) })
    ]));
    $('#compare-table').replaceChildren(el('thead', {}, [head]), el('tbody', {}, body));
    renderPaired(rows.find((r) => r.m.key === state.metric[state.task]));
    renderParticipants();
  }

  $('#c-task').addEventListener('change', (e) => { state.task = e.target.value; renderCompare(); });
  $('#c-axis').addEventListener('change', (e) => { state.axis = e.target.value; renderCompare(); });

  // ---------- 3. 参加者ごとの値 ----------
  function renderParticipants() {
    const axis = AXES[state.axis];
    const ms = metricsFor(state.task);
    const rows = participantValues(state.task, state.axis);
    $('#participant-sub').textContent = `${TASK_LABEL[state.task]}・${axis.groups.map((g) => axis.label[g]).join(' / ')}`;
    const head = el('tr', {}, [
      el('th', { class: 'l', text: '参加者' }), el('th', { class: 'l', text: 'グループ' }),
      el('th', { class: 'l', text: state.axis === 'condition' ? '実施順' : '条件' }),
      el('th', { text: state.task === 'aim_round' ? 'ラウンド' : '区間数' }),
      ...ms.map((m) => el('th', { text: `${m.label}${m.unit ? ` ${m.unit}` : ''}` }))
    ]);
    const body = rows.map((r) => el('tr', {}, [
      el('td', { class: 'l', text: r.participant }),
      el('td', { class: 'l' }, [el('span', { class: `tag ${r.group === axis.groups[0] ? 'a' : 'b'}`, text: axis.label[r.group] })]),
      el('td', { class: 'l dim', text: r.block == null ? '–'
        : state.axis === 'condition' ? `${r.block + 1}回目` : COND_LABEL[r.condition] }),
      el('td', { text: String(r.n) }),
      ...ms.map((m) => el('td', { text: fmt(r.values[m.key], m.unit) }))
    ]));
    $('#participant-table').replaceChildren(el('thead', {}, [head]), el('tbody', {}, body));
  }

  // ---------- 4. Fitts ----------
  function renderFitts() {
    const card = $('#fitts-card');
    const segs = state.segments.filter((s) => s.task === 'aim' && s.included && s.fitts_id != null);
    card.hidden = !segs.length;
    if (!segs.length) return;
    const conds = ['off', 'on'];
    const colors = { off: 'var(--c-a)', on: 'var(--c-b)' };
    const fits = {};
    for (const c of conds) {
      const list = segs.filter((s) => s.condition === c);
      fits[c] = { list, reg: Stats.linreg(list.map((s) => s.fitts_id), list.map((s) => s.time_total_ms)) };
    }
    const W = 560, H = 320, L = 56, R = 16, T = 14, B = 40;
    const xs = segs.map((s) => s.fitts_id), ys = segs.map((s) => s.time_total_ms);
    const tx = niceTicks(Math.floor(Math.min(...xs)), Math.max(...xs), 6);
    const ty = niceTicks(0, Stats.quantile(ys, 0.98), 5);
    const x = (v) => L + (W - L - R) * (v - tx.lo) / (tx.hi - tx.lo);
    const y = (v) => T + (H - T - B) * (1 - (Math.min(v, ty.hi) - ty.lo) / (ty.hi - ty.lo));
    const g = [];
    for (const t of ty.ticks) {
      g.push(svg('line', { x1: L, x2: W - R, y1: y(t), y2: y(t), stroke: '#eceff4' }));
      g.push(svg('text', { x: L - 6, y: y(t) + 4, 'text-anchor': 'end' }, [document.createTextNode(tickLabel(t, ty.step))]));
    }
    for (const t of tx.ticks) {
      g.push(svg('text', { x: x(t), y: H - B + 16, 'text-anchor': 'middle' }, [document.createTextNode(tickLabel(t, tx.step))]));
    }
    g.push(svg('line', { x1: L, x2: W - R, y1: H - B, y2: H - B, stroke: '#c5ccd8' }));
    g.push(svg('line', { x1: L, x2: L, y1: T, y2: H - B, stroke: '#c5ccd8' }));
    g.push(svg('text', { x: (L + W - R) / 2, y: H - 6, 'text-anchor': 'middle' }, [document.createTextNode('難易度 ID (bit)')]));
    g.push(svg('text', { x: 14, y: (T + H - B) / 2, 'text-anchor': 'middle', transform: `rotate(-90 14 ${(T + H - B) / 2})` },
      [document.createTextNode('移動時間 MT (ms)')]));
    for (const c of conds) {
      for (const s of fits[c].list) {
        g.push(svg('circle', { cx: x(s.fitts_id), cy: y(s.time_total_ms), r: 3, fill: colors[c], 'fill-opacity': 0.45 }, [
          svg('title', {}, [document.createTextNode(`${s.participant} ${COND_LABEL[c]}: ID ${s.fitts_id}, ${s.time_total_ms} ms`)])
        ]));
      }
    }
    for (const c of conds) {
      const r = fits[c].reg;
      if (!r) continue;
      const x0 = Math.min(...fits[c].list.map((s) => s.fitts_id)), x1 = Math.max(...fits[c].list.map((s) => s.fitts_id));
      g.push(svg('line', { x1: x(x0), x2: x(x1), y1: y(r.a + r.b * x0), y2: y(r.a + r.b * x1),
        stroke: colors[c], 'stroke-width': 2.5 }));
    }
    // 凡例（線の端に書くと重なるので左上にまとめる）
    conds.forEach((c, i) => {
      const ly = T + 10 + i * 18;
      g.push(svg('line', { x1: L + 12, x2: L + 32, y1: ly, y2: ly, stroke: colors[c], 'stroke-width': 2.5 }));
      g.push(svg('circle', { cx: L + 22, cy: ly, r: 3, fill: colors[c], 'fill-opacity': 0.6 }));
      g.push(svg('text', { x: L + 38, y: ly + 4, fill: 'var(--ink)' }, [document.createTextNode(COND_LABEL[c])]));
    });
    $('#fitts-chart').replaceChildren(svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Fitts の法則の散布図' }, g));

    const head = el('tr', {}, ['条件', '区間数', '切片 a (ms)', '傾き b (ms/bit)', 'R²', 'スループット (bit/s)']
      .map((h, i) => el('th', { class: i === 0 ? 'l' : null, text: h })));
    const body = conds.map((c) => {
      const r = fits[c].reg;
      return el('tr', {}, [
        el('td', { class: 'l' }, [el('span', { class: `tag ${c === 'off' ? 'a' : 'b'}`, text: COND_LABEL[c] })]),
        el('td', { text: String(fits[c].list.length) }),
        el('td', { text: r ? r.a.toFixed(0) : '–' }),
        el('td', { text: r ? r.b.toFixed(1) : '–' }),
        el('td', { text: r && r.r2 != null ? r.r2.toFixed(3) : '–' }),
        el('td', { text: fmt(Stats.mean(fits[c].list.map((s) => s.throughput_bps)), 'bit/s') })
      ]);
    });
    $('#fitts-table').replaceChildren(el('thead', {}, [head]), el('tbody', {}, body),
      el('caption', { class: 'note', style: 'caption-side: bottom; text-align: left',
        text: 'スループットは区間ごとの ID ÷ MT の平均。全参加者の区間をまとめて当てはめています（参加者ごとの比較は上の表の「スループット」）。' }));
  }

  // ---------- 5. 軌跡 ----------
  const panels = [...document.querySelectorAll('.traj[data-side]')].map((root) => ({
    root,
    session: root.querySelector('.t-session'),
    block: root.querySelector('.t-block'),
    page: root.querySelector('.t-page'),
    canvas: root.querySelector('canvas'),
    stats: root.querySelector('.traj-stats')
  }));

  const fileById = (id) => state.files.find((f) => f.id === Number(id));
  const pageEvents = (b) => b.events.filter((e) => e.type === 'page');

  function fillSessionSelect(p, keep) {
    const on = state.files.filter((f) => f.enabled);
    p.session.replaceChildren(...on.map((f) => el('option', { value: String(f.id), text: f.label })));
    if (keep && on.some((f) => String(f.id) === keep)) p.session.value = keep;
  }

  function fillBlockSelect(p, keepIdx) {
    const f = fileById(p.session.value);
    const blocks = f ? f.session.blocks : [];
    p.block.replaceChildren(...blocks.map((b, i) =>
      el('option', { value: String(i), text: `${i + 1}回目：${COND_LABEL[b.condition] || b.condition}` })));
    if (keepIdx != null && blocks[keepIdx]) p.block.value = String(keepIdx);
  }

  function fillPageSelect(p, keepPageId) {
    const f = fileById(p.session.value);
    const b = f && f.session.blocks[Number(p.block.value)];
    const pgs = b ? pageEvents(b) : [];
    p.page.replaceChildren(...pgs.map((pg, i) =>
      el('option', { value: String(i), text: (pg.task === 'aim' ? 'エイム' : pg.page) + (pg.practice ? '（練習）' : '') })));
    if (keepPageId != null) {
      const i = pgs.findIndex((pg) => pg.page === keepPageId);
      if (i >= 0) p.page.value = String(i);
    }
  }

  function currentPageId(p) {
    if (p.page.value === '' || p.block.value === '') return null;
    const f = fileById(p.session.value);
    const b = f && f.session.blocks[Number(p.block.value)];
    const pg = b && pageEvents(b)[Number(p.page.value)];
    return pg ? pg.page : null;
  }

  function syncB() {
    if (!$('#t-sync').checked) return;
    const [a, b] = panels;
    b.session.value = a.session.value;
    const f = fileById(a.session.value);
    const aIdx = Number(a.block.value);
    const other = f ? f.session.blocks.findIndex((_, i) => i !== aIdx) : -1;
    fillBlockSelect(b, other >= 0 ? other : aIdx);
    fillPageSelect(b, currentPageId(a));
  }

  function drawPanel(p) {
    const f = fileById(p.session.value);
    const bi = Number(p.block.value);
    const b = f && f.session.blocks[bi];
    const pg = b && pageEvents(b)[Number(p.page.value)];
    const ctx = p.canvas.getContext('2d');
    if (!pg) {
      p.canvas.width = 10; p.canvas.height = 10;
      p.stats.textContent = '';
      return;
    }
    const events = [...b.events].sort((x, y) => x.t - y.t);
    const endEv = events.find((e) => e.t > pg.t && (e.type === 'page' || e.type === 'screen' || e.type === 'block-end'));
    const tEnd = endEv ? endEv.t : Infinity;
    const prevSel = [...events].reverse().find((e) => e.type === 'select' && e.t <= pg.t);
    const prevDown = prevSel ? [...events].reverse().find((e) => e.type === 'down' && e.t <= prevSel.t) : null;
    const tStart = prevDown ? prevDown.t : pg.t;

    const vw = pg.viewport.w, vh = pg.viewport.h;
    const dpr = window.devicePixelRatio || 1;
    p.canvas.width = vw * dpr;
    p.canvas.height = vh * dpr;
    p.canvas.style.aspectRatio = `${vw} / ${vh}`;
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

    const S = b.samples;
    ctx.strokeStyle = '#8a93a6';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < S.t.length; i++) {
      if (S.t[i] < tStart || S.t[i] > tEnd) continue;
      if (!started) { ctx.moveTo(S.x[i], S.y[i]); started = true; } else ctx.lineTo(S.x[i], S.y[i]);
    }
    ctx.stroke();

    // セッションを無効にしていても軌跡は描けるよう、区間はここで計算し直す
    const blockSegs = Analysis.analyzeBlock(b, state.params);
    const segs = blockSegs.filter((s) => s.page === pg.page);
    const matched = new Set(blockSegs.map((s) => `${s.x1},${s.y1}`));
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

    const inc = segs.filter((s) => Analysis.includedInSummary(s));
    const parts = [
      `区間 ${segs.length}（集計対象 ${inc.length}）`,
      `最後の移動時間の中央値 ${fmt(Stats.median(inc.map((s) => s.time_final_move_ms)), 'ms')} ms`,
      `平均速度の中央値 ${fmt(Stats.median(inc.map((s) => s.speed_active_px_s)), 'px/s')} px/s`,
      `空振り ${segs.reduce((a, s) => a + s.miss_clicks, 0)}`
    ];
    if (pg.task === 'aim') {
      const end = events.find((e) => e.type === 'aim-end' && e.t > pg.t);
      if (end) parts.push(`命中 ${end.hits}・誤選択 ${end.wrong}`);
    }
    p.stats.textContent = parts.join('　');
  }

  function setupPanels() {
    const [a, b] = panels;
    const keepA = a.session.value, keepB = b.session.value;
    fillSessionSelect(a, keepA);
    fillSessionSelect(b, keepB);
    const aBlock = a.block.value, aPage = currentPageId(a);
    fillBlockSelect(a, aBlock === '' ? 0 : Number(aBlock));
    // 最初はアンケートの1ページ目（練習でないもの）を出す
    const f = fileById(a.session.value);
    const firstMain = f && f.session.blocks[Number(a.block.value)]
      ? (pageEvents(f.session.blocks[Number(a.block.value)]).find((pg) => !pg.practice) || {}).page : null;
    fillPageSelect(a, aPage || firstMain);
    if ($('#t-sync').checked) syncB();
    else { fillBlockSelect(b, Number(b.block.value) || 0); fillPageSelect(b, currentPageId(b)); }
    panels.forEach(drawPanel);
  }

  panels.forEach((p, i) => {
    p.session.addEventListener('change', () => {
      fillBlockSelect(p, 0);
      fillPageSelect(p, currentPageId(p));
      if (i === 0) syncB();
      panels.forEach(drawPanel);
    });
    p.block.addEventListener('change', () => {
      const keep = currentPageId(p);
      fillPageSelect(p, keep);
      if (i === 0) syncB();
      panels.forEach(drawPanel);
    });
    p.page.addEventListener('change', () => {
      if (i === 0) syncB();
      panels.forEach(drawPanel);
    });
  });
  $('#t-sync').addEventListener('change', () => { syncB(); panels.forEach(drawPanel); });

  // ---------- パラメータ ----------
  const pPause = $('#p-pause'), pWindow = $('#p-window');
  pPause.value = state.params.PAUSE_MS;
  pWindow.value = state.params.SPEED_WINDOW_MS;
  for (const input of [pPause, pWindow]) {
    input.addEventListener('change', () => {
      const pause = Number(pPause.value), win = Number(pWindow.value);
      if (pause > 0) state.params.PAUSE_MS = pause;
      if (win > 0) state.params.SPEED_WINDOW_MS = win;
      update();
    });
  }

  // ---------- CSV ----------
  const stamp = () => {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
  };

  $('#dl-compare').addEventListener('click', () => {
    const axis = AXES[state.axis];
    const [ga, gb] = axis.groups;
    const rows = lastComparison.map((r) => ({
      task: state.task, axis: state.axis, metric: r.m.key, label: r.m.label, unit: r.m.unit,
      aggregate: r.m.agg, n: r.n, [`${ga}_median`]: r.a, [`${gb}_median`]: r.b,
      [`diff_median(${gb}-${ga})`]: r.diff, W: r.W, p: r.p, effect_r: r.r, method: r.method,
      pause_ms: state.params.PAUSE_MS, speed_window_ms: state.params.SPEED_WINDOW_MS
    }));
    download(`compare_${state.task}_${state.axis}_${stamp()}.csv`, Analysis.toCSV(rows));
  });

  $('#dl-participant').addEventListener('click', () => {
    const rows = [];
    for (const task of ['survey', 'aim', 'aim_round']) {
      for (const r of participantValues(task, state.axis)) {
        const out = { participant: r.participant, task, axis: state.axis, group: r.group,
          block: r.block == null ? '' : r.block + 1, condition: r.condition || '', n: r.n };
        for (const m of METRICS) out[m.key] = ''; // CSV の列をそろえる
        for (const m of metricsFor(task)) out[m.key] = r.values[m.key];
        rows.push(out);
      }
    }
    download(`participants_${state.axis}_${stamp()}.csv`, Analysis.toCSV(rows));
  });

  $('#dl-segments').addEventListener('click', () =>
    download(`all_segments_${stamp()}.csv`, Analysis.toCSV(state.segments.map(({ sid, ...s }) => s))));
  $('#dl-rounds').addEventListener('click', () =>
    download(`aim_rounds_${stamp()}.csv`, Analysis.toCSV(state.rounds.map(({ sid, ...r }) => r))));

  // ---------- 全体の更新 ----------
  function update() {
    const has = state.files.length > 0;
    $('#empty').hidden = has;
    $('#content').hidden = !has;
    $('#clear-all').disabled = !has;
    if (!has) { $('#warnings').replaceChildren(); return; }
    recompute();
    renderSessions();
    renderWarnings();
    renderCompare();
    renderFitts();
    setupPanels();
  }

  // 開発・確認用
  window.__compare = { state, addSessions, comparison, participantValues };
})();
