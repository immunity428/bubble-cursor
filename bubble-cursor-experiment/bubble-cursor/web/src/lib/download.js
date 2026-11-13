// ファイルの保存（ブラウザのダウンロード）
export function download(name, text, type = 'text/plain') {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// Excel で文字化けしないよう BOM を付ける
export const downloadCSV = (name, csv) => download(name, '﻿' + csv, 'text/csv');
export const downloadJSON = (name, obj) => download(name, JSON.stringify(obj), 'application/json');

export function dateStamp(d = new Date(), withTime = false) {
  const p = (n) => String(n).padStart(2, '0');
  const day = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
  return withTime ? `${day}-${p(d.getHours())}${p(d.getMinutes())}` : day;
}

// localStorage は使えない環境（プライベートウィンドウなど）があるので必ず try で包む
export function readStore(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : JSON.parse(v);
  } catch (_) {
    return fallback;
  }
}
export function writeStore(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (_) {
    return false;
  }
}

export const BACKUP_KEY = 'bc-experiment-backups';
