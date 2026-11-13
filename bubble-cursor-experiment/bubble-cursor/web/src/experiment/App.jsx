// 実験の進行：設定 → [説明 → 練習 → アンケート（セットA/B） → エイム課題] × 2条件 → 結果
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Setup, { COND_LABEL } from './Setup.jsx';
import SurveyPage from './SurveyPage.jsx';
import AimTask from './AimTask.jsx';
import Finish from './Finish.jsx';
import { SURVEY, questionCount } from './survey.js';
import { clickOrigin, getServices, live } from './services.js';
import { DEFAULT_PARAMS } from '../lib/analysis.js';
import * as geometry from '../lib/geometry.js';
import { BACKUP_KEY, dateStamp, readStore, writeStore } from '../lib/download.js';

const VERSION = '2.0.0';

const COND_TEXT = {
  off: <>いつもどおりのカーソルでアンケートに答えてください。<br />選択肢の丸か文字の上をクリックすると選べます。</>,
  on: <>カーソルの周りに青い円（バブル）が出ます。<br />円の中にある選択肢が選ばれるので、選択肢の真上でなくてもクリックできます。</>
};

function buildSteps(meta, set) {
  const steps = [{ kind: 'intro', id: 'intro', practice: meta.practice }];
  if (meta.practice) {
    for (const p of SURVEY.practice) steps.push({ kind: 'page', page: p, practice: true });
    steps.push({ kind: 'intro', id: 'intro-main' });
  }
  const pages = SURVEY.sets[set].pages;
  pages.forEach((p, i) => steps.push({ kind: 'page', page: p, practice: false, index: i, total: pages.length }));
  if (meta.aim.seconds > 0) {
    steps.push({ kind: 'intro', id: 'aim-intro', task: 'aim', practice: meta.practice });
    if (meta.practice) {
      steps.push({ kind: 'aim', practice: true, seconds: meta.aim.practiceSeconds, seed: meta.aim.seed + 1000 });
      steps.push({ kind: 'intro', id: 'aim-main', task: 'aim' });
    }
    steps.push({ kind: 'aim', practice: false, seconds: meta.aim.seconds, seed: meta.aim.seed });
  }
  return steps;
}

// ページの番号（Q1, Q2 …）をセット内で通しにするため、前のページまでの質問数を数える
function startNumber(set, pageIndex) {
  return questionCount(SURVEY.sets[set].pages.slice(0, pageIndex)) + 1;
}

function fileBase(meta) {
  return `bc_${meta.participantId.replace(/[^\w-]/g, '_')}_${dateStamp(new Date(meta.startedAt), true)}`;
}

function saveBackup(session) {
  const key = fileBase(session.meta);
  const list = readStore(BACKUP_KEY, []).filter((b) => b.key !== key);
  list.unshift({ key, savedAt: new Date().toISOString(), session });
  // 容量を超えたら古いものから減らして入るまで試す
  for (let n = Math.min(5, list.length); n > 0; n--) if (writeStore(BACKUP_KEY, list.slice(0, n))) return;
}

export default function App() {
  const { bubble, logger, dev } = useMemo(getServices, []);
  const [screen, setScreen] = useState('setup');
  const [stepIdx, setStepIdx] = useState(0);
  const [answers, setAnswers] = useState({});
  const [finished, setFinished] = useState(null);
  const session = useRef(null);
  const block = useRef(null);
  const steps = useRef([]);
  const answersRef = useRef({});
  const stepIdxRef = useRef(0);

  const step = steps.current[stepIdx];

  // 確認・テスト用（コンソールから参照できる）
  useEffect(() => {
    window.__experiment = { get session() { return session.current; }, bubble, logger, dev, geometry };
  }, [bubble, logger, dev]);

  // 開発者モード・キー操作の判定用に、いまの画面を React の外へ伝える
  useEffect(() => {
    live.screen = screen === 'run' ? (step ? (step.kind === 'page' ? 'survey' : step.kind) : 'intro') : screen;
    live.condition = block.current ? block.current.condition : null;
    dev.refresh();
  });

  // ---------- 開始 ----------
  const start = useCallback(async (cfg) => {
    session.current = {
      meta: {
        app: 'bubble-cursor-survey',
        version: VERSION,
        participantId: cfg.pid,
        order: cfg.order,
        sets: cfg.sets,
        assignmentGroup: cfg.group,
        maxRadius: cfg.maxRadius,
        showBubble: cfg.showBubble,
        practice: cfg.practice,
        aim: cfg.aim,
        notes: cfg.notes,
        devMode: cfg.dev,
        startedAt: new Date().toISOString(),
        timeOrigin: performance.timeOrigin,
        userAgent: navigator.userAgent,
        screen: { w: window.screen.width, h: window.screen.height },
        devicePixelRatio: window.devicePixelRatio,
        analysisParams: DEFAULT_PARAMS,
        coordinates: 'CSS px, viewport (clientX/clientY); t = ms since timeOrigin (performance.now)',
        // 質問の中身をそのまま記録に残す（質問文・選択肢・セット）
        survey: SURVEY
      },
      blocks: []
    };
    live.maxRadius = cfg.maxRadius;
    live.devUsed = false;
    bubble.setMaxRadius(cfg.maxRadius);
    bubble.setShowBubble(cfg.showBubble);
    dev.setShow(cfg.devShow);
    dev.setEnabled(cfg.dev, 'setup');
    if (cfg.fullscreen && document.documentElement.requestFullscreen) {
      try { await document.documentElement.requestFullscreen(); } catch (_) { /* 全画面にできなくても続ける */ }
      await new Promise((r) => setTimeout(r, 400)); // 全画面への切り替えを待つ
    }
    startBlock(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function startBlock(i) {
    const meta = session.current.meta;
    const condition = meta.order[i];
    const set = meta.sets[i];
    block.current = {
      index: i, condition, questionSet: set, bubbleEnabled: condition === 'on',
      startedAt: new Date().toISOString(),
      viewport: { w: innerWidth, h: innerHeight },
      fullscreen: !!document.fullscreenElement
    };
    steps.current = buildSteps(meta, set);
    // 設定画面などでスクロールした位置が残っていると、記録の最初にスクロールが入るので先に戻す
    window.scrollTo(0, 0);
    answersRef.current = {};
    setAnswers({});
    logger.start();
    logger.mark('block-start', { condition, set, viewport: block.current.viewport });
    if (dev.isEnabled()) logger.mark('devmode', { on: true, source: 'block-start' });
    bubble.setEnabled(false);
    stepIdxRef.current = 0;
    setStepIdx(0);
    setScreen('run');
    logger.mark('screen', { screen: steps.current[0].id });
  }

  const next = useCallback(() => {
    bubble.setEnabled(false);
    const n = stepIdxRef.current + 1;
    const s = steps.current[n];
    if (!s) { endBlock(); return; }
    if (s.kind === 'intro') logger.mark('screen', { screen: s.id });
    stepIdxRef.current = n;
    setStepIdx(n);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function endBlock() {
    bubble.setEnabled(false);
    logger.mark('block-end', {});
    const { samples, events } = logger.stop();
    const set = block.current.questionSet;
    const final = {};
    for (const p of SURVEY.sets[set].pages) {
      for (const q of p.questions) {
        if (q.type === 'matrix') for (const r of q.rows) final[r.id] = answersRef.current[r.id] ?? null;
        else final[q.id] = answersRef.current[q.id] ?? null;
      }
    }
    session.current.blocks.push({ ...block.current, endedAt: new Date().toISOString(), answers: final, samples, events });
    saveBackup(session.current);
    if (block.current.index + 1 < session.current.meta.order.length) setScreen('break');
    else {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      session.current.meta.endedAt = new Date().toISOString();
      session.current.meta.devModeUsed = live.devUsed;
      saveBackup(session.current);
      setFinished(session.current);
      setScreen('finish');
    }
  }

  // ---------- アンケートのクリック ----------
  const onShown = useCallback((targets, overflow) => {
    const s = steps.current[stepIdxRef.current];
    logger.mark('page', {
      page: s.page.id, task: 'survey', set: s.practice ? '' : block.current.questionSet, practice: s.practice,
      scrollX, scrollY, viewport: { w: innerWidth, h: innerHeight }, overflow, targets
    });
    if (overflow) console.warn(`ページ ${s.page.id} が画面に収まっていません。スクロールした区間は集計から除かれます。`);
    bubble.setEnabled(block.current.condition === 'on');
    bubble.refresh();
    dev.refresh();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onPick = useCallback((btn, nativeEvent) => {
    const s = steps.current[stepIdxRef.current];
    if (!s || s.kind !== 'page') return;
    const { tid, kind } = btn.dataset;
    const origin = clickOrigin(nativeEvent, tid);
    const base = { tid, task: 'survey', page: s.page.id, practice: s.practice, set: s.practice ? '' : block.current.questionSet, ...origin };
    if (kind === 'answer') {
      const { qid, qtype, label } = btn.dataset;
      const value = Number(btn.dataset.value);
      const cur = answersRef.current;
      let nextVal, checked;
      if (qtype === 'multi') {
        const set = new Set(cur[qid] || []);
        checked = !set.has(value);
        if (checked) set.add(value); else set.delete(value);
        nextVal = [...set].sort((a, b) => a - b);
      } else nextVal = value;
      logger.mark('select', { ...base, kind: 'answer', qid, qtype, value, label, ...(qtype === 'multi' ? { checked } : {}) });
      answersRef.current = { ...cur, [qid]: nextVal };
      setAnswers(answersRef.current);
    } else if (kind === 'next') {
      logger.mark('select', { ...base, kind: 'next' });
      next();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 説明画面の「開始」
  const onIntroStart = (e) => {
    const s = steps.current[stepIdx];
    logger.mark('select', {
      tid: 'start', kind: 'start', task: s.task || 'survey', page: s.id, practice: !!s.practice,
      via: e.nativeEvent.isTrusted ? 'direct' : 'synthetic'
    });
    next();
  };

  // キーボードで選べるとマウスの計測にならないので、実験中は止める
  useEffect(() => {
    const onKey = (e) => {
      if (live.screen !== 'survey' && live.screen !== 'intro' && live.screen !== 'aim') return;
      if (e.key === ' ' || e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        logger.mark('key', { key: e.key });
      }
    };
    const onFs = () => {
      if (logger.isRecording()) logger.mark('fullscreen', { on: !!document.fullscreenElement, w: innerWidth, h: innerHeight });
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('fullscreenchange', onFs);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('fullscreenchange', onFs);
    };
  }, [logger]);

  const restart = () => {
    session.current = null;
    block.current = null;
    dev.setEnabled(false, 'restart');
    setFinished(null);
    setScreen('setup');
  };

  // ---------- 描画 ----------
  if (screen === 'setup') return <Setup onStart={start} />;
  if (screen === 'finish') return <Finish session={finished} fileBase={fileBase(finished.meta)} onRestart={restart} />;
  if (screen === 'break') {
    return (
      <section className="screen" data-screen="break">
        <div className="intro">
          <h2>1回目はここまでです</h2>
          <p>少し休んでから、2回目に進んでください。<br />2回目は別のアンケートに答えてもらいます。</p>
        </div>
        <button type="button" className="primary start" id="break-next" onClick={() => startBlock(block.current.index + 1)}>2回目に進む</button>
      </section>
    );
  }

  const meta = session.current.meta;
  const cond = block.current.condition;
  if (step.kind === 'intro') {
    let title, text;
    if (step.id === 'intro') {
      title = COND_LABEL[cond];
      text = <>{COND_TEXT[cond]}{step.practice && <><br /><br />はじめに練習を1ページ行います。</>}</>;
    } else if (step.id === 'intro-main') {
      title = '練習は終わりです';
      text = `ここから本番です。${COND_LABEL[cond]}で答えてください。`;
    } else if (step.id === 'aim-intro') {
      title = `エイム課題（${COND_LABEL[cond]}）`;
      text = (
        <>
          画面にいくつかの丸が出ます。<strong>色の付いた丸</strong>をできるだけ速く、正確にクリックしてください。<br />
          当てると、別の丸が新しい目標になります。<br /><br />
          {step.practice ? `はじめに ${meta.aim.practiceSeconds} 秒間の練習をします。` : `${meta.aim.seconds} 秒間続きます。`}
        </>
      );
    } else {
      title = '練習は終わりです';
      text = `ここから本番です（${meta.aim.seconds} 秒間）。`;
    }
    return (
      <section className="screen" key={step.id} data-screen="intro">
        <div className="intro">
          <p className="block-label">{block.current.index + 1} 回目 / 全 {meta.order.length} 回</p>
          <h2>{title}</h2>
          <p>{text}</p>
        </div>
        {/* 開始ボタンは両条件で同じ位置に置く（最初の区間の出発点をそろえるため） */}
        <button type="button" className="primary start" id="intro-start" data-tid="start" data-kind="start" onClick={onIntroStart}>開始</button>
      </section>
    );
  }

  if (step.kind === 'aim') {
    return <AimTask key={`${block.current.index}-${stepIdx}`} step={step} aim={meta.aim} condition={cond} onDone={next} />;
  }

  // アンケートのページ
  const set = block.current.questionSet;
  const isLast = !step.practice && step.index === step.total - 1;
  return (
    <section className="screen" data-screen="survey">
      <header className="survey-head">
        <span>{step.practice ? `${SURVEY.title}（練習）` : SURVEY.title}</span>
        <span>{step.practice ? '練習' : `${step.index + 1} / ${step.total}`}</span>
      </header>
      <SurveyPage
        key={step.page.id}
        page={step.page}
        answers={answers}
        nextLabel={step.practice ? '練習を終える' : isLast ? '送信' : '次へ'}
        startNum={step.practice ? 1 : startNumber(set, step.index)}
        onShown={onShown}
        onPick={onPick}
      />
    </section>
  );
}
