const DEFAULTS = { enabled: true, showBubble: true, maxRadius: 200 };
const $ = (id) => document.getElementById(id);
const enabled = $('enabled');
const showBubble = $('showBubble');
const maxRadius = $('maxRadius');
const unlimited = $('unlimited');
const radiusValue = $('radiusValue');

function reflect(s) {
  enabled.checked = s.enabled;
  showBubble.checked = s.showBubble;
  unlimited.checked = s.maxRadius === 0;
  if (s.maxRadius > 0) maxRadius.value = s.maxRadius;
  maxRadius.disabled = unlimited.checked;
  radiusValue.textContent = unlimited.checked ? '上限なし' : `${maxRadius.value}px`;
  document.body.classList.toggle('off', !s.enabled);
}

chrome.storage.sync.get(DEFAULTS).then(reflect);
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area === 'sync') reflect(await chrome.storage.sync.get(DEFAULTS));
});

enabled.addEventListener('change', () => chrome.storage.sync.set({ enabled: enabled.checked }));
showBubble.addEventListener('change', () => chrome.storage.sync.set({ showBubble: showBubble.checked }));
maxRadius.addEventListener('input', () => { radiusValue.textContent = `${maxRadius.value}px`; });
maxRadius.addEventListener('change', () => chrome.storage.sync.set({ maxRadius: Number(maxRadius.value) }));
unlimited.addEventListener('change', () => {
  chrome.storage.sync.set({ maxRadius: unlimited.checked ? 0 : Number(maxRadius.value) });
});

chrome.commands.getAll().then((cmds) => {
  const c = cmds.find((x) => x.name === 'toggle-bubble');
  $('shortcut').innerHTML = c && c.shortcut
    ? `<kbd>${c.shortcut.replace(/\+/g, '</kbd> + <kbd>')}</kbd> でオン/オフを切り替え`
    : 'ショートカットは chrome://extensions/shortcuts で設定できます';
});

// ---------- プレビュー：円形ターゲットで論文のアルゴリズムを動かす ----------
const NS = 'http://www.w3.org/2000/svg';
const svg = $('preview');
const TARGETS = [
  [34, 30, 9], [92, 22, 6], [70, 78, 11], [138, 52, 7],
  [186, 24, 10], [204, 88, 6], [240, 54, 9], [30, 96, 6], [128, 104, 5]
];
const mk = (tag, attrs) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
};
const bubble = mk('circle', { fill: 'rgba(61,111,216,.16)', stroke: 'rgba(61,111,216,.6)', 'stroke-width': 1.2 });
const morph = mk('circle', { fill: 'rgba(61,111,216,.16)', stroke: 'rgba(61,111,216,.6)', 'stroke-width': 1.2 });
const dots = TARGETS.map(([cx, cy, r]) => mk('circle', { cx, cy, r, fill: '#AEB7C8' }));
const pointer = mk('circle', { r: 1.8, fill: '#1E2533' });
svg.append(bubble, morph, ...dots, pointer);

function draw(x, y) {
  const list = TARGETS.map(([cx, cy, r], i) => {
    const d = Math.hypot(x - cx, y - cy);
    return { i, cx, cy, r, intD: Math.max(0, d - r), conD: d + r };
  }).sort((a, b) => a.intD - b.intD);
  const j = list[0];
  const radius = Math.min(j.conD, list[1].intD);
  const contained = j.conD <= radius;

  bubble.setAttribute('cx', x); bubble.setAttribute('cy', y); bubble.setAttribute('r', radius);
  pointer.setAttribute('cx', x); pointer.setAttribute('cy', y);
  morph.setAttribute('cx', j.cx); morph.setAttribute('cy', j.cy);
  morph.setAttribute('r', contained ? 0 : j.r + 4);
  dots.forEach((d, i) => d.setAttribute('fill', i === j.i ? '#2554BE' : '#AEB7C8'));
}

function toLocal(e) {
  const p = svg.createSVGPoint();
  p.x = e.clientX; p.y = e.clientY;
  return p.matrixTransform(svg.getScreenCTM().inverse());
}

svg.addEventListener('mousemove', (e) => { const p = toLocal(e); draw(p.x, p.y); });
svg.addEventListener('mouseleave', () => draw(112, 50));
draw(112, 50);
