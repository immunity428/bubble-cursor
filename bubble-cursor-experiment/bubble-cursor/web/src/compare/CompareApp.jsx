// 実験アプリで保存した JSON を複数読み込み、参加者ごとに対にして比較する
import { useEffect, useMemo, useRef, useState } from 'react';
import { analyzeSession, aimRounds, answersTable, questionIndex, toCSV, DEFAULT_PARAMS } from '../lib/analysis.js';
import { drawTrajectory, pageEvents, pageLabel, trajectorySummary } from '../lib/trajectory.js';
import { BACKUP_KEY, dateStamp, downloadCSV, readStore } from '../lib/download.js';
import { AXES, COND_LABEL, TASK_LABEL, checkFiles, comparison, fmt, fmtP, metricsFor, participantValues } from './model.js';
import { FittsChart, PairedChart, fittsFits } from './charts.jsx';

const isSession = (o) => o && o.meta && Array.isArray(o.blocks) && o.meta.participantId != null;
let nextId = 1;

// ---------- データ一覧 ----------
function SessionTable({ files, segments, rounds, setFiles }) {
  return (
    <div className="table-wrap">
      <table id="session-table">
        <thead>
          <tr>
            {['', '参加者', '実施日時', '順番（セット）', '区間（アンケート/エイム）', 'エイム命中 なし/あり', '画面', '最大半径', 'エイム設定', 'ファイル', '']
              .map((h, i) => <th key={i} className={i <= 4 || i >= 9 ? 'l' : null}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {files.map((f) => {
            const m = f.session.meta;
            const segs = segments.filter((s) => s.sid === f.id && s.included);
            const hits = (c) => { const r = rounds.find((x) => x.sid === f.id && x.condition === c); return r ? r.hits : '–'; };
            const vp = f.session.blocks[0] && f.session.blocks[0].viewport;
            const done = `${f.session.blocks.length}/${(m.order || []).length}`;
            const order = (m.order || []).map((c, i) => `${c === 'off' ? 'なし' : 'あり'}${m.sets ? `(${m.sets[i]})` : ''}`).join('→');
            return (
              <tr key={f.id}>
                <td className="l">
                  <input type="checkbox" checked={f.enabled} aria-label={`${f.label} を集計に含める`}
                    onChange={(e) => setFiles((fs) => fs.map((x) => (x.id === f.id ? { ...x, enabled: e.target.checked } : x)))} />
                </td>
                <td className="l">{f.label}</td>
                <td className="l">{m.startedAt ? new Date(m.startedAt).toLocaleString('ja-JP') : '–'}</td>
                <td className="l">{order}{done !== '2/2' ? `（${done}）` : ''}</td>
                <td className="l">{f.enabled ? `${segs.filter((s) => s.task === 'survey').length} / ${segs.filter((s) => s.task === 'aim').length}` : '–'}</td>
                <td>{f.enabled ? `${hits('off')} / ${hits('on')}` : '–'}</td>
                <td>{vp ? `${vp.w}×${vp.h}` : '–'}</td>
                <td>{m.maxRadius ? `${m.maxRadius}px` : '上限なし'}</td>
                <td>{m.aim ? `${m.aim.seconds}秒・${m.aim.targets}個・${m.aim.size}px・種${m.aim.seed}` : '（なし）'}</td>
                <td className="l dim">{f.name}</td>
                <td>
                  <button className="x" type="button" title="外す" aria-label={`${f.label} を外す`}
                    onClick={() => setFiles((fs) => fs.filter((x) => x.id !== f.id))}>×</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------- 回答の集計 ----------
function AnswerSummary({ answers }) {
  const rows = useMemo(() => {
    const by = new Map();
    for (const a of answers) {
      if (a.practice) continue;
      const key = `${a.set}\t${a.qid}`;
      if (!by.has(key)) by.set(key, { set: a.set, qid: a.qid, question: a.question, qtype: a.qtype, off: new Map(), on: new Map(), n: 0 });
      const r = by.get(key);
      r.n++;
      for (const l of String(a.label).split(';').filter(Boolean)) r[a.condition].set(l, (r[a.condition].get(l) || 0) + 1);
    }
    return [...by.values()].sort((x, y) => (x.set + x.qid).localeCompare(y.set + y.qid));
  }, [answers]);
  if (!rows.length) return <p className="note">質問の中身が入った記録（v2 以降）がありません。</p>;
  const dist = (m) => [...m].map(([l, n]) => `${l} ${n}`).join('、') || '–';
  return (
    <div className="table-wrap">
      <table className="answers">
        <thead>
          <tr><th className="l">セット</th><th className="l">ID</th><th className="l">質問</th><th>回答数</th><th className="l">バブルなしでの回答</th><th className="l">バブルありでの回答</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.set + r.qid}>
              <td className="l">{r.set}</td><td className="l">{r.qid}</td>
              <td className="l wrap">{r.question}</td><td>{r.n}</td>
              <td className="l wrap">{dist(r.off)}</td><td className="l wrap">{dist(r.on)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------- 軌跡 ----------
function TrajPanel({ files, sel, onChange, params }) {
  const canvas = useRef(null);
  const [stats, setStats] = useState('');
  const f = files.find((x) => x.id === sel.sid);
  const b = f && f.session.blocks[sel.block];
  const pages = b ? pageEvents(b) : [];
  const qinfo = useMemo(() => (f ? questionIndex(f.session) : null), [f]);
  useEffect(() => {
    if (!canvas.current) return;
    if (!b) { drawTrajectory(canvas.current, { events: [], samples: { t: [] } }, 0); setStats(''); return; }
    const segs = drawTrajectory(canvas.current, b, sel.page, params, qinfo);
    setStats(trajectorySummary(b, sel.page, segs));
  }, [b, sel.page, params, qinfo]);
  return (
    <div className="traj">
      <div className="traj-controls">
        <select value={sel.sid ?? ''} onChange={(e) => onChange({ sid: Number(e.target.value), block: 0, page: 0 })}>
          {files.filter((x) => x.enabled).map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
        </select>
        <select value={sel.block} onChange={(e) => onChange({ ...sel, block: Number(e.target.value) })}>
          {(f ? f.session.blocks : []).map((blk, i) => (
            <option key={i} value={i}>{`${i + 1}回目：${COND_LABEL[blk.condition] || blk.condition}${blk.questionSet ? `（セット${blk.questionSet}）` : ''}`}</option>
          ))}
        </select>
        <select value={sel.page} onChange={(e) => onChange({ ...sel, page: Number(e.target.value) })}>
          {pages.map((pg, i) => <option key={i} value={i}>{pageLabel(pg)}</option>)}
        </select>
      </div>
      <canvas ref={canvas} />
      <p className="traj-stats">{stats}</p>
    </div>
  );
}

// 左と同じ参加者のもう一方のブロックの、同じ位置のページを選ぶ（セットが違えばページIDも違うので、順番で合わせる）
function mirrorOf(files, a) {
  const f = files.find((x) => x.id === a.sid);
  if (!f) return a;
  const other = f.session.blocks.findIndex((_, i) => i !== a.block);
  const block = other >= 0 ? other : a.block;
  const srcPages = pageEvents(f.session.blocks[a.block] || { events: [] });
  const dstPages = pageEvents(f.session.blocks[block] || { events: [] });
  const src = srcPages[a.page];
  let page = 0;
  if (src) {
    const kind = (pg) => `${pg.task || 'survey'}|${pg.practice ? 1 : 0}`;
    const nth = srcPages.slice(0, a.page).filter((pg) => kind(pg) === kind(src)).length;
    const idx = dstPages.map((pg, i) => [pg, i]).filter(([pg]) => kind(pg) === kind(src))[nth];
    if (idx) page = idx[1];
  }
  return { sid: a.sid, block, page };
}

export default function CompareApp() {
  const [files, setFiles] = useState([]);
  const [notices, setNotices] = useState([]);
  const [params, setParams] = useState({ ...DEFAULT_PARAMS });
  const [task, setTask] = useState('survey');
  const [axis, setAxis] = useState('condition');
  const [metric, setMetric] = useState({ survey: 'time_final_move_ms', aim: 'time_final_move_ms', aim_round: 'hits' });
  const [dragging, setDragging] = useState(false);
  const [trajA, setTrajA] = useState({ sid: null, block: 0, page: 0 });
  const [trajB, setTrajB] = useState({ sid: null, block: 1, page: 0 });
  const [sync, setSync] = useState(true);

  const notify = (msg) => setNotices((n) => [...n, { id: Date.now() + Math.random(), msg }]);

  function addSessions(items) {
    setFiles((cur) => {
      const list = [...cur];
      for (const { name, session } of items) {
        if (list.some((f) => f.session.meta.participantId === session.meta.participantId && f.session.meta.startedAt === session.meta.startedAt)) continue;
        const pid = String(session.meta.participantId);
        const same = list.filter((f) => String(f.session.meta.participantId) === pid).length;
        list.push({ id: nextId++, name, session, enabled: true, label: same ? `${pid} (${same + 1})` : pid });
      }
      return list.sort((a, b) => a.label.localeCompare(b.label, 'ja', { numeric: true }));
    });
  }

  async function readFiles(fileList) {
    const items = [], bad = [];
    for (const file of fileList) {
      try {
        const obj = JSON.parse(await file.text());
        if (isSession(obj)) items.push({ name: file.name, session: obj }); else bad.push(file.name);
      } catch (_) { bad.push(file.name); }
    }
    addSessions(items);
    if (bad.length) notify(`実験データとして読めなかったファイル: ${bad.join(', ')}`);
  }

  function loadBackups() {
    const items = readStore(BACKUP_KEY, []).filter((b) => isSession(b.session)).map((b) => ({ name: `${b.key}（ブラウザ内）`, session: b.session }));
    if (!items.length) notify('このブラウザには実験アプリの記録が見つかりませんでした（実験アプリと同じ場所から開いたときだけ読めます）。');
    else addSessions(items);
  }

  // ドラッグ＆ドロップ
  useEffect(() => {
    let depth = 0;
    const enter = (e) => { e.preventDefault(); depth++; setDragging(true); };
    const leave = () => { if (--depth <= 0) { depth = 0; setDragging(false); } };
    const over = (e) => e.preventDefault();
    const drop = (e) => {
      e.preventDefault(); depth = 0; setDragging(false);
      if (e.dataTransfer && e.dataTransfer.files.length) readFiles([...e.dataTransfer.files]);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- 計算（データか閾値が変わったときだけ） ----------
  const { segments, rounds, answers } = useMemo(() => {
    const segs = [], rnds = [], ans = [];
    for (const f of files) {
      if (!f.enabled) continue;
      for (const s of analyzeSession(f.session, params)) segs.push({ ...s, participant: f.label, sid: f.id });
      for (const r of aimRounds(f.session)) if (!r.practice) rnds.push({ ...r, participant: f.label, sid: f.id });
      for (const a of answersTable(f.session)) ans.push({ ...a, participant: f.label });
    }
    return { segments: segs, rounds: rnds, answers: ans };
  }, [files, params]);
  const issues = useMemo(() => checkFiles(files), [files]);
  const pv = useMemo(() => participantValues(files, segments, rounds, task, axis), [files, segments, rounds, task, axis]);
  const rows = useMemo(() => comparison(pv, task, axis), [pv, task, axis]);
  const selKey = rows.find((r) => r.m.key === metric[task]) ? metric[task] : rows[0] && rows[0].m.key;
  const fitts = useMemo(() => fittsFits(segments), [segments]);

  // 軌跡の初期選択と、左に合わせた右の選択
  useEffect(() => {
    const on = files.filter((f) => f.enabled);
    if (!on.length) return;
    if (!on.some((f) => f.id === trajA.sid)) {
      const f = on[0];
      const first = pageEvents(f.session.blocks[0]).findIndex((pg) => !pg.practice);
      setTrajA({ sid: f.id, block: 0, page: Math.max(0, first) });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files]);
  useEffect(() => { if (sync && trajA.sid != null) setTrajB(mirrorOf(files, trajA)); }, [sync, trajA, files]);

  // 確認・テスト用（コンソールから参照できる）
  useEffect(() => {
    window.__compare = {
      files, segments, rounds, answers, issues,
      comparison: (t, a) => comparison(participantValues(files, segments, rounds, t, a), t, a)
    };
  }, [files, segments, rounds, answers, issues]);

  const ax = AXES[axis];
  const [ga, gb] = ax.groups;
  const ms = metricsFor(task);
  const has = files.length > 0;
  const stamp = dateStamp();
  const short = (l) => l.replace('バブル', '');

  return (
    <>
      <header className="top">
        <div className="wrap top-inner">
          <h1>実験データの比較</h1>
          <div className="top-actions">
            <label className="btn primary">JSONを読み込む
              <input type="file" id="file-input" accept=".json,application/json" multiple hidden
                onChange={(e) => { readFiles([...e.target.files]); e.target.value = ''; }} />
            </label>
            <button type="button" className="btn" onClick={loadBackups}>ブラウザ内の記録</button>
            <button type="button" className="btn" disabled={!has}
              onClick={() => { if (confirm('読み込んだデータをすべて外しますか？（ファイルは消えません）')) setFiles([]); }}>すべて外す</button>
          </div>
        </div>
      </header>

      <main className="wrap">
        <div id="warnings">
          {notices.map((n) => (
            <div key={n.id} className="warn">{n.msg}{' '}
              <button className="x" type="button" aria-label="閉じる" onClick={() => setNotices((l) => l.filter((x) => x.id !== n.id))}>×</button>
            </div>
          ))}
        </div>

        {!has && (
          <section className="dropzone">
            <p className="dz-title">実験アプリで保存した JSON をここにドロップ</p>
            <p className="dz-sub">複数まとめて読み込めます。ファイルはブラウザの中だけで処理され、どこにも送信されません。</p>
          </section>
        )}

        {has && (
          <>
            <section className="card">
              <div className="card-head">
                <h2>読み込んだデータ</h2>
                <div className="params">
                  <label>停止とみなす間隔 <input type="number" min="20" max="1000" step="10" defaultValue={params.PAUSE_MS}
                    onChange={(e) => Number(e.target.value) > 0 && setParams((p) => ({ ...p, PAUSE_MS: Number(e.target.value) }))} /> ms</label>
                  <label>最大速度の窓 <input type="number" min="5" max="500" step="5" defaultValue={params.SPEED_WINDOW_MS}
                    onChange={(e) => Number(e.target.value) > 0 && setParams((p) => ({ ...p, SPEED_WINDOW_MS: Number(e.target.value) }))} /> ms</label>
                </div>
              </div>
              {issues.length > 0 && (
                <div className="warn auto">比較の前に確認してください<ul>{issues.map((t) => <li key={t}>{t}</li>)}</ul></div>
              )}
              <SessionTable files={files} segments={segments} rounds={rounds} setFiles={setFiles} />
              <p className="note">チェックを外したデータは、以下のすべての集計から除かれます。</p>
            </section>

            <section className="card">
              <div className="card-head">
                <h2>比較</h2>
                <div className="controls">
                  <label>課題
                    <select id="c-task" value={task} onChange={(e) => setTask(e.target.value)}>
                      <option value="survey">アンケート（区間）</option>
                      <option value="aim">エイム（区間）</option>
                      <option value="aim_round">エイム（成績）</option>
                    </select>
                  </label>
                  <label>比べるもの
                    <select id="c-axis" value={axis} onChange={(e) => setAxis(e.target.value)}>
                      <option value="condition">バブル なし / あり</option>
                      <option value="order">1回目 / 2回目（順序効果の確認）</option>
                      <option value="set">質問セット A / B（セットの差の確認）</option>
                    </select>
                  </label>
                </div>
              </div>
              <p className="note">各参加者の代表値（区間の指標は中央値、回数は合計）を求め、参加者ごとに対にして Wilcoxon 符号順位検定（両側）を行います。行をクリックすると図が切り替わります。</p>
              <div className="compare-grid">
                <div>
                  <h3>{(() => { const r = rows.find((x) => x.m.key === selKey); return r ? `${r.m.label}${r.m.unit ? `（${r.m.unit}）` : ''}` : ''; })()}</h3>
                  <div className="chart"><PairedChart row={rows.find((x) => x.m.key === selKey)} axis={axis} /></div>
                  <p className="legend-line"><span className="ln" />同じ参加者　<span className="md" />中央値</p>
                </div>
                <div className="table-wrap">
                  <table id="compare-table" className="clickable">
                    <thead>
                      <tr>
                        <th className="l">指標</th><th>人数</th><th>{ax.label[ga]}</th><th>{ax.label[gb]}</th>
                        <th>{`差（${short(ax.label[gb])} − ${short(ax.label[ga])}）`}</th><th>W</th><th>p</th><th>効果量 r</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.m.key + r.m.label} className={r.m.key === selKey ? 'sel' : null}
                          onClick={() => setMetric((m) => ({ ...m, [task]: r.m.key }))}>
                          <td className="l">{r.m.label}{r.m.unit ? `（${r.m.unit}）` : ''}</td>
                          <td>{r.n}</td><td>{fmt(r.a, r.m.unit)}</td><td>{fmt(r.b, r.m.unit)}</td>
                          <td>{r.diff == null ? '–' : (r.diff > 0 ? '+' : '') + fmt(r.diff, r.m.unit)}</td>
                          <td>{r.W == null ? '–' : fmt(r.W)}</td>
                          <td className={r.p != null && r.p < 0.05 ? 'sig' : null}
                            title={r.method === 'exact' ? '正確な分布で計算' : r.method === 'normal' ? '正規近似で計算' : null}>
                            {r.p == null ? '–' : fmtP(r.p) + (r.p < 0.05 ? ' *' : '')}
                          </td>
                          <td>{r.r == null ? '–' : r.r.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="row-actions">
                <button type="button" className="btn" onClick={() => downloadCSV(`compare_${task}_${axis}_${stamp}.csv`, toCSV(rows.map((r) => ({
                  task, axis, metric: r.m.key, label: r.m.label, unit: r.m.unit, aggregate: r.m.agg, n: r.n,
                  [`${ga}_median`]: r.a, [`${gb}_median`]: r.b, [`diff_median(${gb}-${ga})`]: r.diff,
                  W: r.W, p: r.p, effect_r: r.r, method: r.method, pause_ms: params.PAUSE_MS, speed_window_ms: params.SPEED_WINDOW_MS
                }))))}>この比較表 (CSV)</button>
                <button type="button" className="btn" onClick={() => {
                  const out = [];
                  for (const t of ['survey', 'aim', 'aim_round']) {
                    for (const r of participantValues(files, segments, rounds, t, axis)) {
                      const row = { participant: r.participant, task: t, axis, group: r.group, block: r.block == null ? '' : r.block + 1, condition: r.condition || '', set: r.set || '', n: r.n };
                      for (const m of metricsFor(t)) row[m.key] = r.values[m.key];
                      out.push(row);
                    }
                  }
                  downloadCSV(`participants_${axis}_${stamp}.csv`, toCSV(out));
                }}>参加者ごとの値 (CSV)</button>
                <button type="button" className="btn" onClick={() => downloadCSV(`all_segments_${stamp}.csv`, toCSV(segments.map(({ sid, ...s }) => s)))}>全区間 (CSV)</button>
                <button type="button" className="btn" onClick={() => downloadCSV(`all_answers_${stamp}.csv`, toCSV(answers))}>全回答 (CSV)</button>
                <button type="button" className="btn" onClick={() => downloadCSV(`aim_rounds_${stamp}.csv`, toCSV(rounds.map(({ sid, ...r }) => r)))}>エイム成績 (CSV)</button>
              </div>
            </section>

            <section className="card">
              <div className="card-head"><h2>参加者ごとの値</h2><span className="sub">{`${TASK_LABEL[task]}・${ax.groups.map((g) => ax.label[g]).join(' / ')}`}</span></div>
              <div className="table-wrap">
                <table id="participant-table">
                  <thead>
                    <tr>
                      <th className="l">参加者</th><th className="l">グループ</th>
                      <th className="l">{axis === 'condition' ? '実施順・セット' : axis === 'order' ? '条件・セット' : '条件・実施順'}</th>
                      <th>{task === 'aim_round' ? 'ラウンド' : '区間数'}</th>
                      {ms.map((m) => <th key={m.key + m.label}>{`${m.label}${m.unit ? ` ${m.unit}` : ''}`}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {pv.map((r) => (
                      <tr key={`${r.sid}-${r.group}`}>
                        <td className="l">{r.participant}</td>
                        <td className="l"><span className={`tag ${r.group === ga ? 'a' : 'b'}`}>{ax.label[r.group]}</span></td>
                        <td className="l dim">{r.block == null ? '–'
                          : axis === 'condition' ? `${r.block + 1}回目${r.set ? `・${r.set}` : ''}`
                            : axis === 'order' ? `${COND_LABEL[r.condition]}${r.set ? `・${r.set}` : ''}`
                              : `${COND_LABEL[r.condition]}・${r.block + 1}回目`}</td>
                        <td>{r.n}</td>
                        {ms.map((m) => <td key={m.key + m.label}>{fmt(r.values[m.key], m.unit)}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="card">
              <div className="card-head"><h2>アンケートの回答</h2><span className="sub">練習を除く。選択肢ごとの人数</span></div>
              <AnswerSummary answers={answers} />
            </section>

            {fitts.segs.length > 0 && (
              <section className="card" id="fitts-card">
                <div className="card-head"><h2>エイム課題：難易度と移動時間（Fitts の法則）</h2></div>
                <p className="note">横軸は Fitts の難易度 ID = log2(D/W+1)、縦軸は前の命中から次の命中までの時間。直線は MT = a + b·ID の当てはめ。</p>
                <div className="compare-grid">
                  <div className="chart"><FittsChart segs={fitts.segs} fits={fitts.fits} /></div>
                  <div className="table-wrap">
                    <table>
                      <thead><tr>{['条件', '区間数', '切片 a (ms)', '傾き b (ms/bit)', 'R²', 'スループット (bit/s)'].map((h, i) => <th key={h} className={i === 0 ? 'l' : null}>{h}</th>)}</tr></thead>
                      <tbody>
                        {['off', 'on'].map((c) => {
                          const { reg, list, tp } = fitts.fits[c];
                          return (
                            <tr key={c}>
                              <td className="l"><span className={`tag ${c === 'off' ? 'a' : 'b'}`}>{COND_LABEL[c]}</span></td>
                              <td>{list.length}</td><td>{reg ? reg.a.toFixed(0) : '–'}</td><td>{reg ? reg.b.toFixed(1) : '–'}</td>
                              <td>{reg && reg.r2 != null ? reg.r2.toFixed(3) : '–'}</td><td>{fmt(tp, 'bit/s')}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    <p className="note">スループットは区間ごとの ID ÷ MT の平均。全参加者の区間をまとめて当てはめています（参加者ごとの比較は上の表の「スループット」）。</p>
                  </div>
                </div>
              </section>
            )}

            <section className="card">
              <div className="card-head">
                <h2>軌跡を並べて見る</h2>
                <label className="check"><input type="checkbox" checked={sync} onChange={(e) => setSync(e.target.checked)} /> 右も同じ参加者のもう一方の回・同じ位置のページにそろえる</label>
              </div>
              <p className="legend-line">
                <span className="ln traj" />カーソルの軌跡　<span className="dot" />回答点・命中（番号 = 区間）
                <span className="sq" />点にならなかったクリック　<span className="tg" />ターゲット
              </p>
              <div className="traj-grid">
                <TrajPanel files={files} sel={trajA} onChange={setTrajA} params={params} />
                <TrajPanel files={files} sel={trajB} onChange={(v) => { setSync(false); setTrajB(v); }} params={params} />
              </div>
            </section>
          </>
        )}
      </main>
      {dragging && <div id="drop-overlay"><p>ここにドロップ</p></div>}
    </>
  );
}
