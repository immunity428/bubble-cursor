// エイム課題：画面に円のターゲットを常に並べ、そのうち1つをランダムに目標にする。当てたら別の目標へ。
// 制限時間まで繰り返す。配置と目標の順番は乱数の種で決まる（同じ種なら両条件・全参加者で同じ）。
//
// 残り時間の表示は 1 秒に何十回も変わるので React の state にせず、要素の文字を直接書き換える。
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { clickOrigin, getServices } from './services.js';

// 旧版（バニラJS）と同じ乱数・配置。種が同じなら旧版と同じ並びになる
export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function aimLayout(rng, n, size, W, H) {
  const margin = size / 2 + 12;
  let minGap = size * 2.5;
  const pts = [];
  while (pts.length < n) {
    let placed = false;
    for (let tries = 0; tries < 3000 && !placed; tries++) {
      const p = { x: margin + rng() * (W - 2 * margin), y: margin + rng() * (H - 2 * margin) };
      if (pts.every((q) => Math.hypot(p.x - q.x, p.y - q.y) >= minGap)) { pts.push(p); placed = true; }
    }
    if (!placed) minGap *= 0.9; // 置ききれないときは間隔を少し詰める
  }
  return pts;
}

const r1 = (v) => Math.round(v * 10) / 10;

export default function AimTask({ step, aim, condition, onDone }) {
  const { bubble, logger, dev } = getServices();
  const arenaRef = useRef(null);
  const progressRef = useRef(null);
  const [pts, setPts] = useState(null);
  const [goal, setGoal] = useState(-1);
  const st = useRef(null);
  const pageId = step.practice ? 'aim-practice' : 'aim';

  // 1. 競技場の大きさが決まったら配置を決める
  useLayoutEffect(() => {
    const ar = arenaRef.current.getBoundingClientRect();
    setPts(aimLayout(mulberry32(step.seed), aim.targets, aim.size, ar.width, ar.height));
  }, [step.seed, aim.targets, aim.size]);

  // 2. ターゲットを描いたら、位置を記録して開始
  useEffect(() => {
    if (!pts) return undefined;
    let raf = 0, endTimer = 0;
    const start = requestAnimationFrame(() => {
      const targets = [...arenaRef.current.querySelectorAll('[data-tid]')].map((b) => {
        const r = b.getBoundingClientRect();
        return { tid: b.dataset.tid, kind: 'aim', shape: 'circle', x: r1(r.left), y: r1(r.top), w: r1(r.width), h: r1(r.height) };
      });
      logger.mark('page', {
        page: pageId, task: 'aim', practice: step.practice, scrollX, scrollY,
        viewport: { w: innerWidth, h: innerHeight }, overflow: false, targets
      });
      const t0 = performance.now();
      const s = {
        active: true, goal: -1, trial: 0, hits: 0, wrong: 0,
        goalRng: mulberry32((step.seed ^ 0x9e3779b9) >>> 0), tEnd: t0 + step.seconds * 1000
      };
      st.current = s;
      logger.mark('aim-start', {
        t: t0, page: pageId, practice: step.practice, seconds: step.seconds,
        targets: aim.targets, size: aim.size, seed: step.seed
      });
      nextGoal();
      bubble.setEnabled(condition === 'on');
      bubble.refresh();
      dev.refresh();

      const tick = () => {
        if (!s.active) return;
        const left = s.tEnd - performance.now();
        if (left <= 0) {
          s.active = false;
          bubble.setEnabled(false);
          logger.mark('aim-end', { page: pageId, hits: s.hits, wrong: s.wrong, trials: s.trial });
          setGoal(-1);
          if (progressRef.current) progressRef.current.textContent = `終了 ・ 命中 ${s.hits}`;
          endTimer = setTimeout(onDone, 800);
          return;
        }
        if (progressRef.current) progressRef.current.textContent = `残り ${(left / 1000).toFixed(1)} 秒 ・ 命中 ${s.hits}`;
        raf = requestAnimationFrame(tick);
      };
      tick();
    });
    return () => {
      cancelAnimationFrame(start);
      cancelAnimationFrame(raf);
      clearTimeout(endTimer);
      if (st.current) st.current.active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pts]);

  function nextGoal() {
    const s = st.current;
    const n = pts.length;
    let i;
    do { i = Math.floor(s.goalRng() * n); } while (n > 1 && i === s.goal);
    s.goal = i;
    s.trial++;
    setGoal(i);
    logger.mark('aim-goal', { trial: s.trial, tid: `aim:${i}` });
  }

  const onClick = (e) => {
    const btn = e.target.closest('[data-tid]');
    const s = st.current;
    if (!btn || !s || !s.active) return;
    const tid = btn.dataset.tid;
    const origin = clickOrigin(e.nativeEvent, tid);
    const hit = tid === `aim:${s.goal}`;
    logger.mark('select', {
      tid, kind: 'aim', task: 'aim', page: pageId, practice: step.practice,
      hit, goal: `aim:${s.goal}`, trial: s.trial, ...origin
    });
    if (hit) { s.hits++; nextGoal(); } else s.wrong++;
  };

  return (
    <section className="screen aim-screen" data-screen="aim">
      <header className="survey-head wide">
        <span>{step.practice ? 'エイム課題（練習）' : 'エイム課題'}</span>
        <span ref={progressRef}>{`残り ${step.seconds.toFixed(1)} 秒`}</span>
      </header>
      <div className="aim-arena" ref={arenaRef} onClick={onClick}>
        {pts && pts.map((p, i) => (
          <button
            key={i} type="button" aria-label={`ターゲット ${i + 1}`}
            className={`aim-target${i === goal ? ' goal' : ''}`}
            data-bc-target="" data-bc-shape="circle" data-tid={`aim:${i}`} data-kind="aim"
            style={{ left: p.x - aim.size / 2, top: p.y - aim.size / 2, width: aim.size, height: aim.size }}
          />
        ))}
      </div>
    </section>
  );
}
