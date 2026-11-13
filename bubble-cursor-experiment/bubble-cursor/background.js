const DEFAULTS = { enabled: true, showBubble: true, maxRadius: 200 };

async function updateBadge(enabled) {
  await chrome.action.setBadgeBackgroundColor({ color: '#687083' });
  await chrome.action.setBadgeText({ text: enabled ? '' : 'OFF' });
}

async function init() {
  const s = await chrome.storage.sync.get(DEFAULTS);
  await chrome.storage.sync.set(s);
  await updateBadge(s.enabled);
}

chrome.runtime.onInstalled.addListener(init);
chrome.runtime.onStartup.addListener(init);

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'toggle-bubble') return;
  const { enabled } = await chrome.storage.sync.get({ enabled: DEFAULTS.enabled });
  await chrome.storage.sync.set({ enabled: !enabled });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.enabled) updateBadge(changes.enabled.newValue);
});
