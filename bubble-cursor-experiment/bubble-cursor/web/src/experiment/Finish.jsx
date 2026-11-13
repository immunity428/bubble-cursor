// 結果画面（実験者向け）：まとめ・回答・軌跡・データの保存
import { useEffect, useMemo, useRef, useState } from 'react';
import { analyzeSession, answersTable, aimRounds, includedInSummary, questionIndex, summarize, toCSV, DEFAULT_PARAMS } from '../lib/analysis.js';
import { drawTrajectory, pageEvents, pageLabel } from '../lib/trajectory.js';
import { downloadCSV, downloadJSON } from '../lib/download.js';
import { COND_LABEL } from './Setup.jsx';

const TASK_LABEL = { survey: 'アンケート', aim: 'エイム' };

const SUMMARY_COLS = [
  ['task', '課題'], ['condition', '条件'], ['n_segments', '区間数'],
  ['aim_hits', '命中数'], ['aim_accuracy', '命中率'], ['throughput_bps_mean', 'スループット bit/s'],
  ['total_time_s', '合計時間 s'],
  ['time_total_ms_median', '区間時間 ms (中央値)'], ['time_final_move_ms_median', '最後の移動時間 ms'],
  ['speed_active_px_s_mean', '平均速度 px/s'], ['speed_peak_px_s_mean', '最大速度 px/s'],
  ['path_px_mean', '経路長 px'], ['straightness_mean', '直進度'],
  ['press_to_target_px_mean', '押下位置→ターゲット px'], ['n_bubble_assisted', 'バブルで補正'],
  ['miss_clicks', '空振り'], ['wrong_selections', '誤選択'], ['revisions', '回答の変更']
];

const SEG_COLS = [
  ['seg', '区間'], ['from', '出発'], ['to', '到着'], ['via', '選択方法'],
  ['time_total_ms', '時間 ms'], ['time_final_move_ms', '最後の移動 ms'],
  ['dist_straight_px', '直線距離 px'], ['path_px', '経路長 px'],
  ['speed_active_px_s', '平均速度 px/s'], ['speed_peak_px_s', '最大速度 px/s'],
  ['straightness', '直進度'], ['press_to_target_px', '押下→ターゲット px'],
  ['throughput_bps', 'スループット bit/s'], ['wrong_selections', '誤選択']
];

function cell(k, v) {
  if (v == null || v === '') return '–';
  if (k === 'condition') return COND_LABEL[v] || v;
  if (k === 'task') return TASK_LABEL[v] || v;
  return String(v);
}

// cols: [列名, 見出し, 'wrap'（長い文を折り返す列）]
export function Table({ cols, rows, className }) {
  // 文字の列は左寄せ（見出しもそろえる）
  const left = new Set(cols.map(([k]) => k).filter((k) => rows.some((r) => typeof r[k] === 'string' && r[k] !== '')));
  const cls = (k, wrap) => [left.has(k) ? 'l' : '', wrap ? 'wrap' : ''].join(' ').trim() || null;
  return (
    <div className="table-wrap">
      <table className={className}>
        <thead><tr>{cols.map(([k, label, wrap]) => <th key={k} className={cls(k, wrap)}>{label}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>{cols.map(([k, , wrap]) => <td key={k} className={cls(k, wrap)}>{cell(k, r[k])}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Viewer({ session }) {
  const firstMain = (blk) => Math.max(0, pageEvents(blk).findIndex((pg) => !pg.practice));
  const [bi, setBi] = useState(0);
  const [pi, setPi] = useState(() => firstMain(session.blocks[0]));
  const canvas = useRef(null);
  const qinfo = useMemo(() => questionIndex(session), [session]);
  const b = session.blocks[bi];
  const pages = pageEvents(b);
  const [rows, setRows] = useState([]);
  useEffect(() => {
    setRows(drawTrajectory(canvas.current, b, Math.min(pi, pages.length - 1), DEFAULT_PARAMS, qinfo));
  }, [b, pi, pages.length, qinfo]);
  return (
    <>
      <div className="viewer-controls">
        <label>ブロック{' '}
          <select value={bi} onChange={(e) => { const i = Number(e.target.value); setBi(i); setPi(firstMain(session.blocks[i])); }}>
            {session.blocks.map((blk, i) => <option key={i} value={i}>{i + 1}: {COND_LABEL[blk.condition]}（セット{blk.questionSet}）</option>)}
          </select>
        </label>
        <label>ページ{' '}
          <select value={pi} onChange={(e) => setPi(Number(e.target.value))}>
            {pages.map((pg, i) => <option key={i} value={i}>{pageLabel(pg)}</option>)}
          </select>
        </label>
      </div>
      <p className="legend">
        <span className="sw line" />カーソルの軌跡
        <span className="sw pt" />回答点（番号 = 区間）
        <span className="sw miss" />回答点にならなかったクリック（空振り・エイムの誤選択）
        <span className="sw rect" />ターゲット
      </p>
      <canvas ref={canvas} className="viewer-canvas" />
      <Table cols={[...SEG_COLS.slice(0, 3), ['question', '質問', 'wrap'], ['label', '選んだ答え', 'wrap'], ...SEG_COLS.slice(3)]} rows={rows} />
    </>
  );
}

export default function Finish({ session, fileBase, onRestart }) {
  const segments = useMemo(() => analyzeSession(session), [session]);
  const summary = useMemo(() => summarize(segments, {}, session), [segments, session]);
  const answers = useMemo(() => answersTable(session), [session]);
  const total = segments.filter((s) => includedInSummary(s)).length;
  const m = session.meta;
  const mainAnswers = answers.filter((a) => !a.practice);

  return (
    <section className="screen" data-screen="finish">
      <div className="panel wide">
        <h1>記録が終わりました</h1>
        <p className="lead" id="finish-lead">
          参加者 {m.participantId}：{m.order.map((c, i) => `${COND_LABEL[c]}（セット${m.sets[i]}）`).join(' → ')}。
          集計に使う区間は {total} 個です。下のボタンでデータを保存してください。
          {m.devModeUsed && '（開発者モードを使った記録です。本番のデータには混ぜないでください）'}
        </p>
        <div className="downloads">
          <button type="button" className="primary" id="dl-json" onClick={() => downloadJSON(`${fileBase}.json`, session)}>生データ (JSON)</button>
          <button type="button" id="dl-seg" onClick={() => downloadCSV(`${fileBase}_segments.csv`, toCSV(segments))}>区間データ (CSV)</button>
          <button type="button" id="dl-ans" onClick={() => downloadCSV(`${fileBase}_answers.csv`, toCSV(answers))}>回答 (CSV)</button>
          <button type="button" id="dl-sum" onClick={() => downloadCSV(`${fileBase}_summary.csv`, toCSV(summary))}>条件別まとめ (CSV)</button>
          <button type="button" id="dl-aim" onClick={() => downloadCSV(`${fileBase}_aim.csv`, toCSV(aimRounds(session)))}>エイム成績 (CSV)</button>
          <button
            type="button" id="restart"
            onClick={() => { if (confirm('データは保存しましたか？ 次の参加者の設定に戻ります。')) onRestart(); }}
          >次の参加者へ</button>
        </div>

        <h2>課題・条件別まとめ（練習・「開始」ボタンへの移動・エイムの1回目・スクロールを含む区間は除く）</h2>
        <Table cols={SUMMARY_COLS} rows={summary} />

        <h2>回答（{mainAnswers.length} 問）</h2>
        <Table
          className="answers-table"
          cols={[['block', '回'], ['condition', '条件'], ['set', 'セット'], ['qid', 'ID'], ['question', '質問', 'wrap'], ['label', '答え', 'wrap'], ['changes', '変更'], ['last_select_ms', '回答まで ms']]}
          rows={mainAnswers}
        />

        <h2>軌跡と回答点</h2>
        <Viewer session={session} />
      </div>
    </section>
  );
}
