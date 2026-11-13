// マウスの動きに反応する部品（バブルカーソル・記録・開発者モード）は React の外で1つだけ作る。
// マウスが動くたびに React が再描画されないようにするため（軽量化の要）。
import { createBubbleCursor } from '../lib/bubbleCursor.js';
import { createCursorLogger } from '../lib/cursorLogger.js';
import { createDevMode } from '../lib/devMode.js';

let services = null;

// 画面の状態（React 側が書き込み、開発者モードやキー操作の判定が読む）
export const live = {
  screen: 'setup',        // 'setup' | 'intro' | 'survey' | 'aim' | 'break' | 'finish'
  condition: null,        // 'off' | 'on'
  maxRadius: 0,
  devUsed: false,
  lastBubble: null        // バブルが補正したクリック { tid, t, radius, intD }
};

export function getServices() {
  if (services) return services;
  const root = document.getElementById('root');
  const bubble = createBubbleCursor({
    root,
    maxRadius: 0,
    onActivate: (info) => {
      live.lastBubble = { tid: info.el.dataset.tid, t: info.t, radius: info.radius, intD: info.intD };
    }
  });
  const logger = createCursorLogger();
  const dev = createDevMode({
    bubble,
    root,
    getContext: () => ({
      active: live.screen === 'survey' || live.screen === 'aim',
      condition: live.condition,
      maxRadius: live.maxRadius
    }),
    onToggle: (on, source) => {
      if (on) live.devUsed = true;
      if (logger.isRecording()) logger.mark('devmode', { on, source });
    }
  });
  services = { bubble, logger, dev };
  return services;
}

// クリックがバブルの補正によるものかを判定し、記録に添える情報を返す
export function clickOrigin(nativeEvent, tid) {
  const lb = live.lastBubble;
  live.lastBubble = null;
  if (nativeEvent && nativeEvent.isTrusted) return { via: 'direct' };
  if (lb && lb.tid === tid && performance.now() - lb.t < 500) {
    return { via: 'bubble', bubble_radius: Math.round(lb.radius * 10) / 10, bubble_intD: Math.round(lb.intD * 10) / 10 };
  }
  return { via: 'synthetic' };
}
