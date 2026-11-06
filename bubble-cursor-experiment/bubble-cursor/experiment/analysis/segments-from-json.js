#!/usr/bin/env node
// 生データ(JSON)から区間データ(CSV)を作り直す。停止の閾値などを変えて再分析したいとき用。
//
//   node analysis/segments-from-json.js data/*.json > all_segments.csv
//   node analysis/segments-from-json.js --pause 150 --window 50 data/*.json > all_segments.csv
//
// 計算はブラウザと同じ js/analysis.js を使う。
const fs = require('fs');
const path = require('path');
const Analysis = require(path.join(__dirname, '..', 'js', 'analysis.js'));

const args = process.argv.slice(2);
const params = {};
const files = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--pause') params.PAUSE_MS = Number(args[++i]);
  else if (args[i] === '--window') params.SPEED_WINDOW_MS = Number(args[++i]);
  else files.push(args[i]);
}
if (!files.length) {
  console.error('使い方: node segments-from-json.js [--pause ms] [--window ms] file1.json file2.json ...');
  process.exit(1);
}

const rows = [];
for (const f of files) {
  const session = JSON.parse(fs.readFileSync(f, 'utf8'));
  for (const s of Analysis.analyzeSession(session, params)) {
    rows.push({ ...s, file: path.basename(f) });
  }
}
process.stdout.write('﻿' + Analysis.toCSV(rows));
console.error(`${files.length} ファイル、${rows.length} 区間`);
