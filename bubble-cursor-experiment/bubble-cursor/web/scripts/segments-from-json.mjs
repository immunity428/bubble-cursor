#!/usr/bin/env node
// 生データ(JSON)から区間データ・回答の CSV を作り直す。停止の閾値などを変えて再分析したいとき用。
//
//   node web/scripts/segments-from-json.mjs data/*.json > all_segments.csv
//   node web/scripts/segments-from-json.mjs --pause 150 --window 50 data/*.json > all_segments.csv
//   node web/scripts/segments-from-json.mjs --answers data/*.json > all_answers.csv
//
// 計算は実験アプリ・比較ページと同じ web/src/lib/analysis.js を使う。
import fs from 'node:fs';
import path from 'node:path';
import { analyzeSession, answersTable, toCSV } from '../src/lib/analysis.js';

const args = process.argv.slice(2);
const params = {};
const files = [];
let answers = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--pause') params.PAUSE_MS = Number(args[++i]);
  else if (args[i] === '--window') params.SPEED_WINDOW_MS = Number(args[++i]);
  else if (args[i] === '--answers') answers = true;
  else files.push(args[i]);
}
if (!files.length) {
  console.error('使い方: node segments-from-json.mjs [--pause ms] [--window ms] [--answers] file1.json file2.json ...');
  process.exit(1);
}

const rows = [];
for (const f of files) {
  const session = JSON.parse(fs.readFileSync(f, 'utf8'));
  const list = answers ? answersTable(session) : analyzeSession(session, params);
  for (const r of list) rows.push({ ...r, file: path.basename(f) });
}
process.stdout.write('﻿' + toCSV(rows));
console.error(`${files.length} ファイル、${rows.length} 行`);
