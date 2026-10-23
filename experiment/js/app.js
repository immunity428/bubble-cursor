// 実験の進行（設定 → ブロック1 → 休憩 → ブロック2 → 結果）
(() => {
  'use strict';

  const VERSION = '1.1.0';
  const AIM_PRACTICE_SECONDS = 5;
  const BACKUP_KEY = 'bc-experiment-backups';
  const COND_LABEL = { off: 'バブルカーソル なし', on: 'バブルカーソル あり' };
  const COND_TEXT = {
    off: 'いつもどおりのカーソルでアンケートに答えてください。<br>選択肢の丸か文字の上をクリックすると選べます。',
    on: 'カーソルの周りに青い円（バブル）が出ます。<br>円の中にある選択肢が選ばれるので、選択肢の真上でなくてもクリックできます。'
  };

  const TASK_LABEL = { survey: 'アンケート', aim: 'エイム' };

  const $ = (s, r = document) => r.querySelector(s);
  const SURVEY = window.SURVEY;
  const surveyRoot = $('#survey');

  let lastBubble = null;
  const bubble = BubbleCursor.create({
    root: surveyRoot,
    maxRadius: 0,
    onActivate: (info) => {
      lastBubble = { tid: info.el.dataset.tid, t: info.t, radius: info.radius, intD: info.intD };
    }
  });
  const logger = CursorLogger.create();

  let session = null;
  let block = null;
  let steps = [];
  let stepIdx = 0;
  let answers = {};
  let currentScreen = 'setup';

  function show(name) {
    currentScreen = name;
    document.querySelectorAll('[data-screen]').forEach((el) => { el.hidden = el.dataset.screen !== name; });
  }

  // ---------- 設定画面 ----------
  const form = $('#setup-form');

  function autoOrder(pid) {
    const m = String(pid).match(/\d+/g);
    if (!m) return ['off', 'on'];
    return Number(m[m.length - 1]) % 2 === 1 ? ['off', 'on'] : ['on', 'off'];
  }

  function chosenOrder() {
    const v = form.order.value;
    return v === 'auto' ? autoOrder(form.pid.value) : v.split(',');
  }

  function updateOrderPreview() {
    const o = chosenOrder();
    $('#order-preview').textContent = `この参加者: ${o.map((c) => COND_LABEL[c]).join(' → ')}`;
  }
  form.addEventListener('input', updateOrderPreview);
  updateOrderPreview();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const order = chosenOrder();
    session = {
      meta: {
        app: 'bubble-cursor-survey',
        version: VERSION,
        participantId: String(fd.get('pid')).trim(),
        order,
        maxRadius: Number(fd.get('maxRadius')) || 0,
        showBubble: fd.get('showBubble') === 'on',
        practice: fd.get('practice') === 'on',
        aim: {
          seconds: Math.max(0, Number(fd.get('aimSeconds')) || 0),
          targets: Math.max(2, Number(fd.get('aimTargets')) || 10),
          size: Math.max(4, Number(fd.get('aimSize')) || 24),
          seed: Number(fd.get('aimSeed')) || 1,
          practiceSeconds: AIM_PRACTICE_SECONDS
        },
        notes: String(fd.get('notes') || ''),
        startedAt: new Date().toISOString(),
        timeOrigin: performance.timeOrigin,
        userAgent: navigator.userAgent,
        screen: { w: window.screen.width, h: window.screen.height },
        devicePixelRatio: window.devicePixelRatio,
        analysisParams: Analysis.DEFAULT_PARAMS,
        coordinates: 'CSS px, viewport (clientX/clientY); t = ms since timeOrigin (performance.now)'
      },
      blocks: []
    };
    bubble.setMaxRadius(session.meta.maxRadius);
    bubble.setShowBubble(session.meta.showBubble);
    if (fd.get('fullscreen') === 'on' && document.documentElement.requestFullscreen) {
      try { await document.documentElement.requestFullscreen(); } catch (_) { /* 全画面にできなくても続ける */ }
      await new Promise((r) => setTimeout(r, 400)); // 全画面への切り替えを待つ
    }
    startBlock(0);
  });

  // ---------- ブロック ----------
  function startBlock(i) {
    const condition = session.meta.order[i];
    block = {
      index: i,
      condition,
      bubbleEnabled: condition === 'on',
      startedAt: new Date().toISOString(),
      viewport: { w: innerWidth, h: innerHeight },
      fullscreen: !!document.fullscreenElement
    };
    answers = {};
    steps = [{ kind: 'intro', id: 'intro', practice: session.meta.practice }];
    if (session.meta.practice) {
      for (const p of SURVEY.practice) steps.push({ kind: 'page', page: p, practice: true });
      steps.push({ kind: 'intro', id: 'intro-main', practice: false });
    }
    for (const p of SURVEY.pages) steps.push({ kind: 'page', page: p, practice: false });
    const aim = session.meta.aim;
    if (aim.seconds > 0) {
      steps.push({ kind: 'intro', id: 'aim-intro', task: 'aim', practice: session.meta.practice });
      if (session.meta.practice) {
        steps.push({ kind: 'aim', practice: true, seconds: aim.practiceSeconds, seed: aim.seed + 1000 });
        steps.push({ kind: 'intro', id: 'aim-main', task: 'aim', practice: false });
      }
      steps.push({ kind: 'aim', practice: false, seconds: aim.seconds, seed: aim.seed });
    }
    stepIdx = 0;
    logger.start();
    logger.mark('block-start', { condition, viewport: block.viewport });
    runStep();
  }

  function runStep() {
    const step = steps[stepIdx];
    if (!step) { endBlock(); return; }
    bubble.setEnabled(false);
    if (step.kind === 'intro') showIntro(step);
    else if (step.kind === 'aim') showAim(step);
    else showPage(step);
  }

  function nextStep() {
    stepIdx++;
    runStep();
  }

  function showIntro(step) {
    const n = session.meta.order.length;
    $('#intro-block').textContent = `${block.index + 1} 回目 / 全 ${n} 回`;
    if (step.id === 'intro') {
      $('#intro-title').textContent = COND_LABEL[block.condition];
      $('#intro-text').innerHTML = COND_TEXT[block.condition] +
        (step.practice ? '<br><br>はじめに練習を1ページ行います。' : '');
    } else if (step.id === 'intro-main') {
      $('#intro-title').textContent = '練習は終わりです';
      $('#intro-text').innerHTML = `ここから本番です。${COND_LABEL[block.condition]}で答えてください。`;
    } else if (step.id === 'aim-intro') {
      $('#intro-title').textContent = `エイム課題（${COND_LABEL[block.condition]}）`;
      $('#intro-text').innerHTML =
        '画面にいくつかの丸が出ます。<strong>色の付いた丸</strong>をできるだけ速く、正確にクリックしてください。<br>' +
        '当てると、別の丸が新しい目標になります。' +
        (step.practice
          ? `<br><br>はじめに ${session.meta.aim.practiceSeconds} 秒間の練習をします。`
          : `<br><br>${session.meta.aim.seconds} 秒間続きます。`);
    } else if (step.id === 'aim-main') {
      $('#intro-title').textContent = '練習は終わりです';
      $('#intro-text').innerHTML = `ここから本番です（${session.meta.aim.seconds} 秒間）。`;
    }
    show('intro');
    logger.mark('screen', { screen: step.id });
  }

  $('#intro-start').addEventListener('click', (e) => {
    if (currentScreen !== 'intro') return;
    const step = steps[stepIdx];
    logger.mark('select', {
      tid: 'start', kind: 'start', task: step.task || 'survey', page: step.id, practice: !!step.practice,
      via: e.isTrusted ? 'direct' : 'synthetic'
    });
    nextStep();
  });

  // ---------- アンケートのページ ----------
  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'text') node.textContent = v;
      else if (k === 'class') node.className = v;
      else node.setAttribute(k, v);
    }
    for (const c of children || []) node.appendChild(c);
    return node;
  }

  function showPage(step) {
    const { page, practice } = step;
    const mainPages = SURVEY.pages;
    $('#survey-title').textContent = practice ? `${SURVEY.title}（練習）` : SURVEY.title;
    $('#survey-progress').textContent = practice ? '練習' : `${mainPages.indexOf(page) + 1} / ${mainPages.length}`;

    const qs = el('div', { class: 'questions' });
    page.questions.forEach((q) => {
      const opts = el('div', { class: 'opts', role: 'radiogroup', 'aria-label': q.text });
      q.options.forEach((label, i) => {
        const value = i + 1;
        opts.appendChild(el('button', {
          type: 'button', class: 'opt', role: 'radio', 'aria-checked': 'false',
          'data-bc-target': '', 'data-tid': `${q.id}:${value}`, 'data-kind': 'answer',
          'data-qid': q.id, 'data-value': String(value), text: label
        }));
      });
      const num = el('span', { class: 'q-num', text: q.id.toUpperCase() });
      const text = el('p', { class: 'q-text' }, [num, document.createTextNode(q.text)]);
      qs.appendChild(el('div', { class: `q ${q.type}`, 'data-q': q.id }, [text, opts]));
    });
    const isLast = !practice && mainPages.indexOf(page) === mainPages.length - 1;
    const next = el('button', {
      type: 'button', class: 'next', disabled: '',
      'data-bc-target': '', 'data-tid': `next:${page.id}`, 'data-kind': 'next',
      text: practice ? '練習を終える' : (isLast ? '送信' : '次へ')
    });
    surveyRoot.replaceChildren(qs, el('div', { class: 'next-row' }, [next]));
    show('survey');

    // レイアウトが確定してからターゲットの位置を記録する
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const targets = [...surveyRoot.querySelectorAll('[data-tid]')].map((b) => {
        const r = b.getBoundingClientRect();
        return {
          tid: b.dataset.tid, kind: b.dataset.kind,
          x: Math.round(r.left * 10) / 10, y: Math.round(r.top * 10) / 10,
          w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10
        };
      });
      const overflow = document.documentElement.scrollHeight > innerHeight + 1;
      logger.mark('page', {
        page: page.id, practice, scrollX, scrollY, viewport: { w: innerWidth, h: innerHeight }, overflow, targets
      });
      if (overflow) console.warn(`ページ ${page.id} が画面に収まっていません。スクロールした区間は集計から除かれます。`);
      bubble.setEnabled(block.condition === 'on');
      bubble.refresh();
    }));
  }

  surveyRoot.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-tid]');
    if (!btn || btn.disabled || currentScreen !== 'survey') return;
    if (btn.dataset.kind === 'aim' && !(aimState && aimState.active)) return;
    const step = steps[stepIdx];
    const tid = btn.dataset.tid;
    let via = 'direct';
    const extra = {};
    if (!e.isTrusted) {
      if (lastBubble && lastBubble.tid === tid && performance.now() - lastBubble.t < 500) {
        via = 'bubble';
        extra.bubble_radius = Math.round(lastBubble.radius * 10) / 10;
        extra.bubble_intD = Math.round(lastBubble.intD * 10) / 10;
      } else via = 'synthetic';
    }
    lastBubble = null;

    if (btn.dataset.kind === 'answer') {
      const { qid, value } = btn.dataset;
      logger.mark('select', {
        tid, kind: 'answer', task: 'survey', qid, value: Number(value), label: btn.textContent,
        page: step.page.id, practice: step.practice, via, ...extra
      });
      answers[qid] = Number(value);
      btn.parentElement.querySelectorAll('.opt').forEach((o) => o.setAttribute('aria-checked', String(o === btn)));
      const done = step.page.questions.every((q) => answers[q.id] != null);
      surveyRoot.querySelector('.next').disabled = !done;
    } else if (btn.dataset.kind === 'aim') {
      onAimSelect(tid, via, extra);
    } else if (btn.dataset.kind === 'next') {
      logger.mark('select', { tid, kind: 'next', task: 'survey', page: step.page.id, practice: step.practice, via, ...extra });
      nextStep();
    }
  });

  // ---------- エイム課題 ----------
  // 画面にターゲット（円）を常に並べ、そのうち1つをランダムに目標にする。当てたら別の目標へ。制限時間まで繰り返す。
  // 配置と目標の順番は乱数の種（seed）で決まるので、同じ種なら両条件・全参加者で同じ並びになる。
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function aimLayout(rng, n, size, W, H) {
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

  let aimState = null;

  function showAim(step) {
    const aim = session.meta.aim;
    const pageId = step.practice ? 'aim-practice' : 'aim';
    $('#survey-title').textContent = step.practice ? 'エイム課題（練習）' : 'エイム課題';
    $('#survey-progress').textContent = `残り ${step.seconds.toFixed(1)} 秒`;
    const arena = el('div', { class: 'aim-arena' });
    surveyRoot.replaceChildren(arena);
    show('survey');

    requestAnimationFrame(() => requestAnimationFrame(() => {
      const ar = arena.getBoundingClientRect();
      const rng = mulberry32(step.seed);
      const pts = aimLayout(rng, aim.targets, aim.size, ar.width, ar.height);
      const buttons = pts.map((p, i) => {
        const b = el('button', {
          type: 'button', class: 'aim-target', 'aria-label': `ターゲット ${i + 1}`,
          'data-bc-target': '', 'data-bc-shape': 'circle', 'data-tid': `aim:${i}`, 'data-kind': 'aim'
        });
        b.style.left = `${p.x - aim.size / 2}px`;
        b.style.top = `${p.y - aim.size / 2}px`;
        b.style.width = b.style.height = `${aim.size}px`;
        arena.appendChild(b);
        return b;
      });
      const targets = buttons.map((b) => {
        const r = b.getBoundingClientRect();
        return {
          tid: b.dataset.tid, kind: 'aim', shape: 'circle',
          x: Math.round(r.left * 10) / 10, y: Math.round(r.top * 10) / 10,
          w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10
        };
      });
      logger.mark('page', {
        page: pageId, task: 'aim', practice: step.practice, scrollX, scrollY,
        viewport: { w: innerWidth, h: innerHeight }, overflow: false, targets
      });

      const t0 = performance.now();
      aimState = {
        active: true, step, pageId, buttons, goal: null, trial: 0, hits: 0, wrong: 0,
        goalRng: mulberry32((step.seed ^ 0x9e3779b9) >>> 0), tEnd: t0 + step.seconds * 1000
      };
      logger.mark('aim-start', {
        t: t0, page: pageId, practice: step.practice, seconds: step.seconds,
        targets: aim.targets, size: aim.size, seed: step.seed
      });
      nextAimGoal();
      bubble.setEnabled(block.condition === 'on');
      bubble.refresh();
      tickAim();
    }));
  }

  function nextAimGoal() {
    const s = aimState;
    const n = s.buttons.length;
    let i;
    do { i = Math.floor(s.goalRng() * n); } while (n > 1 && `aim:${i}` === s.goal);
    if (s.goal) s.buttons[Number(s.goal.split(':')[1])].classList.remove('goal');
    s.goal = `aim:${i}`;
    s.trial++;
    s.buttons[i].classList.add('goal');
    logger.mark('aim-goal', { trial: s.trial, tid: s.goal });
  }

  function onAimSelect(tid, via, extra) {
    const s = aimState;
    const hit = tid === s.goal;
    logger.mark('select', {
      tid, kind: 'aim', task: 'aim', page: s.pageId, practice: s.step.practice,
      hit, goal: s.goal, trial: s.trial, via, ...extra
    });
    if (hit) { s.hits++; nextAimGoal(); } else s.wrong++;
  }

  function tickAim() {
    const s = aimState;
    if (!s || !s.active) return;
    const left = s.tEnd - performance.now();
    if (left <= 0) { endAim(); return; }
    $('#survey-progress').textContent = `残り ${(left / 1000).toFixed(1)} 秒 ・ 命中 ${s.hits}`;
    requestAnimationFrame(tickAim);
  }

  function endAim() {
    const s = aimState;
    s.active = false;
    bubble.setEnabled(false);
    logger.mark('aim-end', { page: s.pageId, hits: s.hits, wrong: s.wrong, trials: s.trial });
    if (s.goal) s.buttons[Number(s.goal.split(':')[1])].classList.remove('goal');
    $('#survey-progress').textContent = `終了 ・ 命中 ${s.hits}`;
    setTimeout(() => { aimState = null; nextStep(); }, 800);
  }

  // キーボードで選べるとマウスの計測にならないので、実験中は止める
  document.addEventListener('keydown', (e) => {
    if (currentScreen !== 'survey' && currentScreen !== 'intro') return;
    if (e.key === ' ' || e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      logger.mark('key', { key: e.key });
    }
  }, true);

  document.addEventListener('fullscreenchange', () => {
    if (logger.isRecording()) logger.mark('fullscreen', { on: !!document.fullscreenElement, w: innerWidth, h: innerHeight });
  });

  function endBlock() {
    bubble.setEnabled(false);
    logger.mark('block-end', {});
    const { samples, events } = logger.stop();
    const surveyAnswers = {};
    for (const p of SURVEY.pages) for (const q of p.questions) surveyAnswers[q.id] = answers[q.id] ?? null;
    session.blocks.push({ ...block, endedAt: new Date().toISOString(), answers: surveyAnswers, samples, events });
    saveBackup();
    if (block.index + 1 < session.meta.order.length) show('break');
    else finish();
  }

  $('#break-next').addEventListener('click', () => startBlock(block.index + 1));

  // ---------- 保存 ----------
  function fileBase() {
    const d = new Date(session.meta.startedAt);
    const p = (n) => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
    return `bc_${session.meta.participantId.replace(/[^\w-]/g, '_')}_${stamp}`;
  }

  function download(name, text, type) {
    const blob = new Blob([text], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ダウンロードし忘れに備えて、ブラウザ内にも直近の記録を残す（容量を超えたら諦める）
  function saveBackup() {
    try {
      const list = JSON.parse(localStorage.getItem(BACKUP_KEY) || '[]').filter((b) => b.key !== fileBase());
      list.unshift({ key: fileBase(), savedAt: new Date().toISOString(), session });
      localStorage.setItem(BACKUP_KEY, JSON.stringify(list.slice(0, 5)));
    } catch (err) {
      console.warn('ブラウザ内への保存に失敗しました（容量超過の可能性）', err);
    }
  }

  function renderBackups() {
    let list = [];
    try { list = JSON.parse(localStorage.getItem(BACKUP_KEY) || '[]'); } catch (_) { /* noop */ }
    const box = $('#backups');
    if (!list.length) { box.replaceChildren(); return; }
    const ul = el('ul');
    list.forEach((b) => {
      const btn = el('button', { type: 'button', text: 'JSONを保存' });
      btn.addEventListener('click', () => download(`${b.key}.json`, JSON.stringify(b.session), 'application/json'));
      const done = b.session.blocks.length;
      ul.appendChild(el('li', {}, [
        document.createTextNode(`${b.key}（${done}/${b.session.meta.order.length} ブロック）`), btn
      ]));
    });
    box.replaceChildren(el('p', { text: 'ブラウザ内に残っている記録（直近5件）' }), ul);
  }
  renderBackups();

  // ---------- 結果画面 ----------
  let segments = [];
  let summary = [];

  function finish() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    session.meta.endedAt = new Date().toISOString();
    saveBackup();
    segments = Analysis.analyzeSession(session);
    summary = Analysis.summarize(segments, {}, session);
    const total = segments.filter((s) => Analysis.includedInSummary(s)).length;
    $('#finish-lead').textContent =
      `参加者 ${session.meta.participantId}：${session.meta.order.map((c) => COND_LABEL[c]).join(' → ')}。` +
      `集計に使う区間は ${total} 個です。下のボタンでデータを保存してください。`;
    renderSummary();
    setupViewer();
    show('finish');
  }

  const SUMMARY_COLS = [
    ['task', '課題'], ['condition', '条件'], ['n_segments', '区間数'],
    ['aim_hits', '命中数'], ['aim_accuracy', '命中率'], ['throughput_bps_mean', 'スループット bit/s'], ['total_time_s', '合計時間 s'],
    ['time_total_ms_median', '区間時間 ms (中央値)'], ['time_final_move_ms_median', '最後の移動時間 ms'],
    ['speed_active_px_s_mean', '平均速度 px/s'], ['speed_peak_px_s_mean', '最大速度 px/s'],
    ['path_px_mean', '経路長 px'], ['straightness_mean', '直進度'],
    ['press_to_target_px_mean', '押下位置→ターゲット px'], ['n_bubble_assisted', 'バブルで補正'],
    ['miss_clicks', '空振り'], ['wrong_selections', '誤選択'], ['revisions', '回答の変更']
  ];

  function renderTable(table, cols, rows) {
    const head = el('tr', {}, cols.map(([, label]) => el('th', { text: label })));
    const body = rows.map((r) => el('tr', {}, cols.map(([k]) => {
      let v = r[k];
      if (k === 'condition') v = COND_LABEL[v] || v;
      if (k === 'task') v = TASK_LABEL[v] || v;
      return el('td', { text: v == null ? '–' : String(v) });
    })));
    table.replaceChildren(el('thead', {}, [head]), el('tbody', {}, body));
  }

  function renderSummary() {
    renderTable($('#summary-table'), SUMMARY_COLS, summary);
  }

  const vBlock = $('#v-block');
  const vPage = $('#v-page');
  const canvas = $('#v-canvas');

  function setupViewer() {
    vBlock.replaceChildren(...session.blocks.map((b, i) =>
      el('option', { value: String(i), text: `${i + 1}: ${COND_LABEL[b.condition]}` })));
    vBlock.onchange = fillPages;
    vPage.onchange = drawViewer;
    fillPages();
  }

  function pageEvents(b) {
    return b.events.filter((e) => e.type === 'page');
  }

  function fillPages() {
    const b = session.blocks[Number(vBlock.value)];
    vPage.replaceChildren(...pageEvents(b).map((pg, i) =>
      el('option', { value: String(i), text: pg.practice ? `${pg.page}（練習）` : pg.page })));
    drawViewer();
  }

  function drawViewer() {
    const bi = Number(vBlock.value);
    const b = session.blocks[bi];
    const pgs = pageEvents(b);
    const pg = pgs[Number(vPage.value)];
    if (!pg) return;
    const endEv = b.events.find((e) => e.t > pg.t && (e.type === 'page' || e.type === 'screen' || e.type === 'block-end'));
    const tEnd = endEv ? endEv.t : Infinity;
    // ページ表示前の区間（前のページの「次へ」→このページ）も見えるよう、直前の選択から描く
    const prevSel = [...b.events].reverse().find((e) => e.type === 'select' && e.t <= pg.t);
    const prevDown = prevSel ? [...b.events].reverse().find((e) => e.type === 'down' && e.t <= prevSel.t) : null;
    const tStart = prevDown ? prevDown.t : pg.t;

    const vw = pg.viewport.w, vh = pg.viewport.h;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = vw * dpr;
    canvas.height = vh * dpr;
    canvas.style.aspectRatio = `${vw} / ${vh}`;
    const ctx = canvas.getContext('2d');
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
        continue;
      }
      ctx.fillRect(t.x, t.y, t.w, t.h);
      ctx.strokeRect(t.x + 0.5, t.y + 0.5, t.w - 1, t.h - 1);
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

    // 何も選ばれなかったクリック（空振り）
    const segs = segments.filter((s) => s.block === b.index);
    const matched = new Set(segs.map((s) => `${s.x1},${s.y1}`));
    ctx.strokeStyle = '#e09a1a';
    ctx.lineWidth = 2;
    for (const d of b.events) {
      if (d.type !== 'down' || d.t < pg.t || d.t > tEnd) continue;
      if (matched.has(`${d.x},${d.y}`)) continue;
      ctx.strokeRect(d.x - 5, d.y - 5, 10, 10);
    }

    // 回答点（このページで選んだもの）
    const rows = [];
    ctx.font = '600 12px system-ui, sans-serif';
    for (const s of segs) {
      if (s.page !== pg.page) continue;
      rows.push(s);
      ctx.fillStyle = '#d1453b';
      ctx.beginPath();
      ctx.arc(s.x1, s.y1, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#1d2330';
      ctx.fillText(String(s.seg), s.x1 + 8, s.y1 - 6);
    }

    renderTable($('#v-table'), [
      ['seg', '区間'], ['from', '出発'], ['to', '到着'], ['via', '選択方法'],
      ['time_total_ms', '時間 ms'], ['time_final_move_ms', '最後の移動 ms'],
      ['dist_straight_px', '直線距離 px'], ['path_px', '経路長 px'],
      ['speed_active_px_s', '平均速度 px/s'], ['speed_peak_px_s', '最大速度 px/s'],
      ['straightness', '直進度'], ['press_to_target_px', '押下→ターゲット px'],
      ['throughput_bps', 'スループット bit/s'], ['wrong_selections', '誤選択']
    ], rows);
  }

  $('#dl-json').addEventListener('click', () =>
    download(`${fileBase()}.json`, JSON.stringify(session), 'application/json'));
  // Excel で文字化けしないよう BOM を付ける
  $('#dl-seg').addEventListener('click', () =>
    download(`${fileBase()}_segments.csv`, '﻿' + Analysis.toCSV(segments), 'text/csv'));
  $('#dl-aim').addEventListener('click', () =>
    download(`${fileBase()}_aim.csv`, '\ufeff' + Analysis.toCSV(Analysis.aimRounds(session)), 'text/csv'));
  $('#dl-sum').addEventListener('click', () =>
    download(`${fileBase()}_summary.csv`, '﻿' + Analysis.toCSV(summary), 'text/csv'));
  $('#restart').addEventListener('click', () => {
    if (!confirm('データは保存しましたか？ 次の参加者の設定に戻ります。')) return;
    session = null;
    form.reset();
    updateOrderPreview();
    renderBackups();
    show('setup');
  });

  // 開発・確認用（コンソールから参照できる）
  window.__experiment = { get session() { return session; }, get segments() { return segments; }, bubble };
})();
