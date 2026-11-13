// 実験者が設定する画面
import { useMemo, useState } from 'react';
import { autoAssignment, checkSetsMatch, SURVEY } from './survey.js';
import { BACKUP_KEY, downloadJSON, readStore } from '../lib/download.js';

export const COND_LABEL = { off: 'バブルカーソル なし', on: 'バブルカーソル あり' };
const SHORT = { off: 'なし', on: 'あり' };

// 条件の順番と質問セットを決める
export function resolveAssignment(pid, orderMode, setMode) {
  const auto = autoAssignment(pid);
  const order = orderMode === 'auto' ? auto.order : orderMode.split(',');
  let sets;
  if (setMode === 'auto') sets = auto.sets;                    // ブロック1・2に入れるセット
  else {
    const [forOff, forOn] = setMode.split(',');                 // 'A,B' = なし→A・あり→B
    sets = order.map((c) => (c === 'off' ? forOff : forOn));
  }
  return { order, sets, group: orderMode === 'auto' && setMode === 'auto' ? auto.group : null };
}

const DEV_FROM_URL = new URLSearchParams(location.search).has('dev');

function Backups() {
  const list = readStore(BACKUP_KEY, []);
  if (!list.length) return null;
  return (
    <div className="backups">
      <p>ブラウザ内に残っている記録（直近5件）</p>
      <ul>
        {list.map((b) => (
          <li key={b.key}>
            {b.key}（{b.session.blocks.length}/{b.session.meta.order.length} ブロック）
            <button type="button" onClick={() => downloadJSON(`${b.key}.json`, b.session)}>JSONを保存</button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function Setup({ onStart }) {
  const [pid, setPid] = useState('');
  const [orderMode, setOrderMode] = useState('auto');
  const [setMode, setSetMode] = useState('auto');
  const [dev, setDev] = useState(DEV_FROM_URL);
  const problems = useMemo(() => checkSetsMatch(SURVEY), []);
  const plan = resolveAssignment(pid, orderMode, setMode);

  const submit = (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const num = (k, d) => (fd.get(k) === '' || fd.get(k) == null ? d : Number(fd.get(k)));
    onStart({
      pid: String(fd.get('pid')).trim(),
      ...plan,
      maxRadius: Math.max(0, num('maxRadius', 0) || 0),
      showBubble: fd.get('showBubble') === 'on',
      practice: fd.get('practice') === 'on',
      fullscreen: fd.get('fullscreen') === 'on',
      notes: String(fd.get('notes') || ''),
      dev,
      devShow: {
        regions: fd.get('devRegions') === 'on',
        circles: fd.get('devCircles') === 'on',
        labels: fd.get('devLabels') === 'on'
      },
      aim: {
        seconds: Math.max(0, num('aimSeconds', 15)),
        targets: Math.max(2, num('aimTargets', 10) || 10),
        size: Math.max(4, num('aimSize', 24) || 24),
        seed: num('aimSeed', 1) || 1,
        practiceSeconds: 5
      }
    });
  };

  return (
    <section className="screen" data-screen="setup">
      <div className="panel">
        <h1>Bubble Cursor アンケート実験</h1>
        <p className="lead">
          「バブルカーソルなし」「あり」の2条件で、別々のマウス操作アンケート（同じレイアウトで中身がちがう2セット）と
          エイム課題を行ってもらい、クリックした点のあいだのカーソル移動を記録します。
        </p>
        {problems.length > 0 && (
          <div className="warn">
            質問セット A と B の形がそろっていません（比較が公平になりません）：
            <ul>{problems.map((p) => <li key={p}>{p}</li>)}</ul>
          </div>
        )}
        <form id="setup-form" onSubmit={submit}>
          <label className="field">
            <span>参加者ID</span>
            <input name="pid" required autoComplete="off" placeholder="例: P01" value={pid} onChange={(e) => setPid(e.target.value)} />
          </label>
          <label className="field">
            <span>条件の順番</span>
            <select name="order" value={orderMode} onChange={(e) => setOrderMode(e.target.value)}>
              <option value="auto">自動（IDの番号で入れ替え）</option>
              <option value="off,on">なし → あり</option>
              <option value="on,off">あり → なし</option>
            </select>
          </label>
          <label className="field">
            <span>質問セットの割り当て</span>
            <select name="sets" value={setMode} onChange={(e) => setSetMode(e.target.value)}>
              <option value="auto">自動（IDの番号で入れ替え。4人1組で全組み合わせがそろう）</option>
              <option value="A,B">固定：なし = A、あり = B</option>
              <option value="B,A">固定：なし = B、あり = A</option>
            </select>
            <small id="order-preview">
              この参加者：{plan.order.map((c, i) => `${SHORT[c]}（セット${plan.sets[i]}）`).join(' → ')}
              {plan.group ? `　［組 ${plan.group}］` : ''}
            </small>
          </label>
          <label className="field">
            <span>バブルの最大半径 (px)</span>
            <input name="maxRadius" type="number" min="0" max="2000" step="10" defaultValue="0" />
            <small>0 = 上限なし（論文と同じ）。拡張機能版の初期値は 200</small>
          </label>
          <label className="check"><input type="checkbox" name="showBubble" defaultChecked /> バブルを表示する</label>
          <label className="check"><input type="checkbox" name="practice" defaultChecked /> 各ブロックの前に練習ページを入れる</label>
          <label className="check"><input type="checkbox" name="fullscreen" defaultChecked /> 全画面で実施する</label>
          <label className="check dev">
            <input type="checkbox" name="dev" id="dev-check" checked={dev} onChange={(e) => setDev(e.target.checked)} />
            開発者モード（各ターゲットをどこからクリックできるかを表示）
          </label>
          <div className="dev-opts">
            <span>表示するもの</span>
            <label className="check"><input type="checkbox" name="devRegions" defaultChecked /> 正確な範囲（色分け）</label>
            <label className="check"><input type="checkbox" name="devCircles" defaultChecked /> 確実に選べる円</label>
            <label className="check"><input type="checkbox" name="devLabels" /> ラベル（ID と半径）</label>
          </div>
          <p className="hint">
            実験中も Alt+Shift+D（Mac は Option+Shift+D）で切り替えられます。使った記録には印が付きます。<br />
            Windows で Alt+Shift が入力言語の切り替えに使われて効かないときは、ここのチェックで設定してください。
          </p>
          <fieldset className="group">
            <legend>エイム課題（アンケートのあとに各条件で実施）</legend>
            <div className="grid2">
              <label className="field">
                <span>制限時間 (秒)</span>
                <input name="aimSeconds" type="number" min="0" max="600" step="1" defaultValue="15" />
                <small>0 = 実施しない</small>
              </label>
              <label className="field">
                <span>ターゲットの数</span>
                <input name="aimTargets" type="number" min="2" max="60" step="1" defaultValue="10" />
              </label>
              <label className="field">
                <span>ターゲットの直径 (px)</span>
                <input name="aimSize" type="number" min="4" max="200" step="1" defaultValue="24" />
              </label>
              <label className="field">
                <span>乱数の種</span>
                <input name="aimSeed" type="number" step="1" defaultValue="1" />
                <small>同じ値なら配置と目標の順番が同じになる</small>
              </label>
            </div>
          </fieldset>
          <label className="field">
            <span>メモ（任意）</span>
            <input name="notes" autoComplete="off" placeholder="使用したマウス、ポインタ速度の設定など" />
          </label>
          <button type="submit" className="primary">実験を始める</button>
        </form>
        <Backups />
      </div>
    </section>
  );
}
