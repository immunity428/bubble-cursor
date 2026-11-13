// ビルド：React のアプリを、ダブルクリックで開ける1つの HTML ファイルにまとめる
//
//   npm run build        本番用（圧縮）→ ../experiment/index.html と ../compare/index.html
//   npm run dev          開発用（圧縮なし・React の警告あり）
//
// <script type="module"> は file:// で開くと読み込めないことがあるので、ふつうの <script> に JS を埋め込む。
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dev = process.argv.includes('--dev');

const PAGES = [
  { entry: 'src/experiment/main.jsx', out: '../experiment/index.html', title: 'Bubble Cursor アンケート実験' },
  { entry: 'src/compare/main.jsx', out: '../compare/index.html', title: 'Bubble Cursor 実験データの比較' }
];

// node build.mjs experiment のように名前を渡すと、そのページだけ作る
const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const targets = only.length ? PAGES.filter((p) => only.some((o) => p.entry.includes(o))) : PAGES;

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;

for (const page of targets) {
  const result = await esbuild.build({
    entryPoints: [path.join(here, page.entry)],
    bundle: true,
    write: false,
    outdir: path.join(here, 'out'),
    format: 'iife',
    target: ['chrome100', 'edge100', 'firefox100', 'safari15'],
    jsx: 'automatic',
    minify: !dev,
    legalComments: 'none',
    define: { 'process.env.NODE_ENV': JSON.stringify(dev ? 'development' : 'production') },
    loader: { '.js': 'jsx' },
    logLevel: 'warning'
  });
  const js = result.outputFiles.find((f) => f.path.endsWith('.js')).text.replace(/<\/script/gi, '<\\/script');
  const cssFile = result.outputFiles.find((f) => f.path.endsWith('.css'));
  const css = cssFile ? cssFile.text : '';
  const html = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${page.title}</title>
<!-- このファイルは web/ のソースから自動で作られます。直接編集せず、web/ を直して npm run build してください -->
<style>${css}</style>
</head>
<body>
<div id="root"></div>
<script>${js}</script>
</body>
</html>
`;
  const out = path.join(here, page.out);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, html);
  console.log(`${page.out}  ${kb(html.length)}（gzip ${kb(zlib.gzipSync(html).length)}）`);
}
