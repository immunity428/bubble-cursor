// カーソル軌跡とクリックの記録
// - pointermove を getCoalescedEvents() で取り、マウスのポーリングレート相当の細かさで座標を残す
// - 時刻はすべて performance.now() と同じ基準（ページを開いた時点からのms）
// - 座標はビューポート座標（clientX/Y, CSS px）
(function (global) {
  'use strict';

  const r1 = (v) => Math.round(v * 10) / 10;

  function create() {
    let recording = false;
    let samples = { t: [], x: [], y: [] };
    let events = [];
    let lastT = -Infinity;

    function push(t, x, y) {
      // 同じ時刻のサンプルが重複して届くことがあるので除く
      if (t <= lastT) return;
      lastT = t;
      samples.t.push(r1(t));
      samples.x.push(r1(x));
      samples.y.push(r1(y));
    }

    function tidOf(target) {
      const el = target instanceof Element ? target.closest('[data-tid]') : null;
      return el ? el.dataset.tid : null;
    }

    const onMove = (e) => {
      if (!recording || !e.isTrusted || e.pointerType !== 'mouse') return;
      const list = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
      if (list.length) for (const c of list) push(c.timeStamp, c.clientX, c.clientY);
      else push(e.timeStamp, e.clientX, e.clientY);
    };
    const onDown = (e) => {
      if (!recording || !e.isTrusted) return;
      push(e.timeStamp, e.clientX, e.clientY);
      events.push({ type: 'down', t: r1(e.timeStamp), x: r1(e.clientX), y: r1(e.clientY),
        button: e.button, pointerType: e.pointerType, tid: tidOf(e.target) });
    };
    const onUp = (e) => {
      if (!recording || !e.isTrusted) return;
      events.push({ type: 'up', t: r1(e.timeStamp), x: r1(e.clientX), y: r1(e.clientY),
        button: e.button, tid: tidOf(e.target) });
    };
    const onScroll = () => {
      if (recording) events.push({ type: 'scroll', t: r1(performance.now()), sx: scrollX, sy: scrollY });
    };
    const onResize = () => {
      if (recording) events.push({ type: 'resize', t: r1(performance.now()), w: innerWidth, h: innerHeight });
    };
    const onBlur = () => { if (recording) events.push({ type: 'blur', t: r1(performance.now()) }); };
    const onFocus = () => { if (recording) events.push({ type: 'focus', t: r1(performance.now()) }); };
    const onVis = () => {
      if (recording) events.push({ type: 'visibility', t: r1(performance.now()), state: document.visibilityState });
    };
    const onWheel = (e) => {
      if (recording && e.isTrusted) events.push({ type: 'wheel', t: r1(e.timeStamp), dy: r1(e.deltaY) });
    };

    const opt = { capture: true, passive: true };
    const handlers = [
      [window, 'pointermove', onMove, opt],
      [window, 'pointerdown', onDown, opt],
      [window, 'pointerup', onUp, opt],
      [window, 'scroll', onScroll, opt],
      [window, 'resize', onResize, opt],
      [window, 'wheel', onWheel, opt],
      [window, 'blur', onBlur, undefined],
      [window, 'focus', onFocus, undefined],
      [document, 'visibilitychange', onVis, undefined]
    ];
    for (const [target, type, fn, o] of handlers) target.addEventListener(type, fn, o);

    return {
      start() {
        samples = { t: [], x: [], y: [] };
        events = [];
        lastT = -Infinity;
        recording = true;
      },
      stop() {
        recording = false;
        return { samples, events };
      },
      isRecording() { return recording; },
      // アプリ側の出来事（回答の選択、ページ表示など）を記録する
      mark(type, data) {
        const t = data && typeof data.t === 'number' ? data.t : performance.now();
        events.push({ ...data, type, t: r1(t) });
      },
      lastPosition() {
        const n = samples.t.length;
        return n ? { t: samples.t[n - 1], x: samples.x[n - 1], y: samples.y[n - 1] } : null;
      },
      destroy() {
        recording = false;
        for (const [target, type, fn, o] of handlers) target.removeEventListener(type, fn, o);
      }
    };
  }

  global.CursorLogger = { create };
})(window);
