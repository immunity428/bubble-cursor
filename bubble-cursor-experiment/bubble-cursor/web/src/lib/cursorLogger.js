// カーソル軌跡とクリックの記録
// - pointermove を getCoalescedEvents() で取り、マウスのポーリングレート相当の細かさで座標を残す
// - 時刻はすべて performance.now() と同じ基準（ページを開いた時点からのms）
// - 座標はビューポート座標（clientX/Y, CSS px）
//
// 軽量化：座標は 0.1 単位の整数にして Int32Array に詰める（足りなくなったら倍に広げる）。
// 普通の配列に数値オブジェクトを積み上げないので、記録中のメモリ確保とガベージコレクションがほとんど起きない。
// 書き出すときは今までと同じ { t: [], x: [], y: [] }（小数1桁）の形に戻す。

const INITIAL = 1 << 14; // 16384 サンプル（1000Hz のマウスで約16秒分）から始める

function createBuffer() {
  let cap = INITIAL;
  let n = 0;
  let t = new Int32Array(cap), x = new Int32Array(cap), y = new Int32Array(cap);
  const grow = () => {
    cap *= 2;
    const nt = new Int32Array(cap), nx = new Int32Array(cap), ny = new Int32Array(cap);
    nt.set(t); nx.set(x); ny.set(y);
    t = nt; x = nx; y = ny;
  };
  return {
    get length() { return n; },
    lastT() { return n ? t[n - 1] : -Infinity; },
    push(tt, xx, yy) {
      if (n === cap) grow();
      t[n] = tt; x[n] = xx; y[n] = yy;
      n++;
    },
    last() { return n ? { t: t[n - 1] / 10, x: x[n - 1] / 10, y: y[n - 1] / 10 } : null; },
    toJSON() {
      const out = { t: new Array(n), x: new Array(n), y: new Array(n) };
      for (let i = 0; i < n; i++) { out.t[i] = t[i] / 10; out.x[i] = x[i] / 10; out.y[i] = y[i] / 10; }
      return out;
    }
  };
}

const r1 = (v) => Math.round(v * 10) / 10;
const q10 = (v) => Math.round(v * 10);

export function createCursorLogger() {
  let recording = false;
  let buf = createBuffer();
  let events = [];
  let lastScroll = { x: 0, y: 0 };

  function push(t, x, y) {
    const tt = q10(t);
    // 同じ時刻のサンプルが重複して届くことがあるので除く
    if (tt <= buf.lastT()) return;
    buf.push(tt, q10(x), q10(y));
  }

  function tidOf(target) {
    const el = target instanceof Element ? target.closest('[data-tid]') : null;
    return el ? el.dataset.tid : null;
  }

  const onMove = (e) => {
    if (!recording || !e.isTrusted || e.pointerType !== 'mouse') return;
    const list = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : null;
    if (list && list.length) for (let i = 0; i < list.length; i++) push(list[i].timeStamp, list[i].clientX, list[i].clientY);
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
    events.push({ type: 'up', t: r1(e.timeStamp), x: r1(e.clientX), y: r1(e.clientY), button: e.button, tid: tidOf(e.target) });
  };
  const now = () => r1(performance.now());
  // 位置が実際に変わったときだけ記録する（scrollTo(0,0) の通知が遅れて届いたものなどは除く）
  const onScroll = () => {
    if (!recording || (scrollX === lastScroll.x && scrollY === lastScroll.y)) return;
    lastScroll = { x: scrollX, y: scrollY };
    events.push({ type: 'scroll', t: now(), sx: scrollX, sy: scrollY });
  };
  const onResize = () => { if (recording) events.push({ type: 'resize', t: now(), w: innerWidth, h: innerHeight }); };
  const onBlur = () => { if (recording) events.push({ type: 'blur', t: now() }); };
  const onFocus = () => { if (recording) events.push({ type: 'focus', t: now() }); };
  const onVis = () => { if (recording) events.push({ type: 'visibility', t: now(), state: document.visibilityState }); };
  const onWheel = (e) => { if (recording && e.isTrusted) events.push({ type: 'wheel', t: r1(e.timeStamp), dy: r1(e.deltaY) }); };

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
      buf = createBuffer();
      events = [];
      lastScroll = { x: scrollX, y: scrollY };
      recording = true;
    },
    stop() {
      recording = false;
      return { samples: buf.toJSON(), events };
    },
    isRecording: () => recording,
    sampleCount: () => buf.length,
    // アプリ側の出来事（回答の選択、ページ表示など）を記録する
    mark(type, data) {
      const t = data && typeof data.t === 'number' ? data.t : performance.now();
      events.push({ ...data, type, t: r1(t) });
    },
    lastPosition: () => buf.last(),
    destroy() {
      recording = false;
      for (const [target, type, fn, o] of handlers) target.removeEventListener(type, fn, o);
    }
  };
}
