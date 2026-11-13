// アンケートの1ページ。選択肢はすべて data-bc-target を持つボタンで、バブルカーソルのターゲットになる。
// クリックはページ全体で1か所で受け取り（イベント委譲）、data-* から何が押されたかを読む。
import { memo, useLayoutEffect, useRef } from 'react';

const TYPE_CLASS = {
  likert5: 'full', likert7: 'half', choice: 'half', grid: 'half', multi: 'half', matrix: 'full'
};

// 1つの選択肢ボタン
function Opt({ qid, qtype, value, label, checked, kind = 'radio', className = '' }) {
  return (
    <button
      type="button"
      className={`opt is-${kind} ${className}`}
      role={kind === 'check' ? 'checkbox' : 'radio'}
      aria-checked={checked ? 'true' : 'false'}
      aria-label={label}
      data-bc-target=""
      data-tid={`${qid}:${value}`}
      data-kind="answer"
      data-qid={qid}
      data-qtype={qtype}
      data-value={value}
      data-label={label}
    >
      <span className="mark" aria-hidden="true" />
      <span className="lbl">{label}</span>
    </button>
  );
}

function Scale({ q, answer }) {
  return (
    <>
      <div className={`opts scale n${q.options.length}`} role="radiogroup" aria-label={q.text}>
        {q.options.map((label, i) => (
          <Opt key={i} qid={q.id} qtype={q.type} value={i + 1} label={label} checked={answer === i + 1} />
        ))}
      </div>
      {q.anchors && (
        <div className="anchors" aria-hidden="true"><span>{q.anchors[0]}</span><span>{q.anchors[1]}</span></div>
      )}
    </>
  );
}

function Choice({ q, answer }) {
  const multi = q.type === 'multi';
  const chosen = multi ? new Set(answer || []) : null;
  return (
    <div className={`opts ${q.type}`} role={multi ? 'group' : 'radiogroup'} aria-label={q.text}>
      {q.options.map((label, i) => (
        <Opt
          key={i} qid={q.id} qtype={q.type} value={i + 1} label={label}
          kind={multi ? 'check' : 'radio'}
          checked={multi ? chosen.has(i + 1) : answer === i + 1}
        />
      ))}
    </div>
  );
}

function Matrix({ q, answers }) {
  return (
    <table className="matrix" role="presentation">
      <thead>
        <tr>
          <th className="row-h" />
          {q.options.map((o, i) => <th key={i} scope="col">{o}</th>)}
        </tr>
      </thead>
      <tbody>
        {q.rows.map((row) => (
          <tr key={row.id} role="radiogroup" aria-label={row.text}>
            <th scope="row" className="row-h">{row.text}</th>
            {q.options.map((label, i) => (
              <td key={i}>
                <Opt qid={row.id} qtype="matrix" value={i + 1} label={label} checked={answers[row.id] === i + 1} className="cell" />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Question({ q, num, answers }) {
  return (
    <div className={`q ${q.type} ${TYPE_CLASS[q.type] || 'half'}`} data-q={q.id}>
      <p className="q-text"><span className="q-num">{num}</span>{q.text}</p>
      {q.type === 'matrix' ? <Matrix q={q} answers={answers} />
        : q.type === 'likert5' || q.type === 'likert7' ? <Scale q={q} answer={answers[q.id]} />
          : <Choice q={q} answer={answers[q.id]} />}
    </div>
  );
}

export function isComplete(page, answers) {
  return page.questions.every((q) => {
    if (q.type === 'matrix') return q.rows.every((r) => answers[r.id] != null);
    if (q.type === 'multi') return Array.isArray(answers[q.id]) && answers[q.id].length > 0;
    return answers[q.id] != null;
  });
}

// props:
//   page, practice, answers, nextLabel, startNum
//   onShown(targets)  レイアウトが決まったときに1回呼ぶ（ターゲットの位置を記録するため）
//   onPick(target, nativeEvent)  選択肢・次へのクリック
function SurveyPage({ page, answers, nextLabel, startNum, onShown, onPick }) {
  const ref = useRef(null);
  const complete = isComplete(page, answers);

  // ページが変わったら、レイアウトが確定してからターゲットの位置を測る
  useLayoutEffect(() => {
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        const r1 = (v) => Math.round(v * 10) / 10;
        const targets = [...ref.current.querySelectorAll('[data-tid]')].map((b) => {
          const r = b.getBoundingClientRect();
          return { tid: b.dataset.tid, kind: b.dataset.kind, x: r1(r.left), y: r1(r.top), w: r1(r.width), h: r1(r.height) };
        });
        onShown(targets, document.documentElement.scrollHeight > innerHeight + 1);
      });
    });
    return () => { cancelAnimationFrame(raf1); cancelAnimationFrame(raf2); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page.id]);

  const onClick = (e) => {
    const btn = e.target.closest('[data-tid]');
    if (!btn || btn.disabled || !ref.current.contains(btn)) return;
    onPick(btn, e.nativeEvent);
  };

  let num = startNum;
  return (
    <div className="survey" ref={ref} onClick={onClick}>
      <div className="questions">
        {page.questions.map((q) => {
          const n = num;
          num += q.type === 'matrix' ? q.rows.length : 1;
          const label = q.type === 'matrix' ? `Q${n}–${n + q.rows.length - 1}` : `Q${n}`;
          return <Question key={q.id} q={q} num={label} answers={answers} />;
        })}
      </div>
      <div className="next-row">
        <button
          type="button" className="next" disabled={!complete}
          data-bc-target="" data-tid={`next:${page.id}`} data-kind="next"
        >
          {nextLabel}
        </button>
      </div>
    </div>
  );
}

export default memo(SurveyPage);
