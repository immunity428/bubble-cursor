// アンケートの中身（マウス操作に関する質問）
//
// バブルなし／ありで同じ質問に2回答えると、2回目は「さっきと同じ場所を押すだけ」になってしまう。
// そこで、中身のちがう2つの質問セット（A・B）を用意し、条件ごとに別のセットに答えてもらう。
//
// ★ A と B は「形」を完全にそろえる（カーソル移動の比較を公平にするため）
//   - ページ数、各ページの質問の数と並び、質問の種類、選択肢の数を同じにする
//   - 選択肢のボタンは文字の長さに関係なく同じ大きさで描く（CSS で固定）
//   - 質問文は2行分の高さに固定（1行でも2行でも位置がずれない）
//   checkSetsMatch() で形がそろっているかを確かめられる（起動時にも確認する）
//
// ★ 1ページは画面に収まる量にする（スクロールすると位置がずれるので、その区間は集計から外れる）
// ★ 自由記述（キーボード入力）は入れない
//
// 質問の種類 type:
//   likert5  5段階（横一列）             options: 5つ
//   likert7  7段階（横一列、1〜7）        options: 7つ（両端の言葉を anchors に）
//   choice   単一選択（縦に並べる）       options: 5つ
//   grid     単一選択（2列の格子）        options: 6つ
//   multi    複数選択（2列の格子）        options: 6つ
//   matrix   マトリクス（行 × 5段階）     rows: 4行, options: 5つ

const AGREE5 = ['そう思わない', 'あまり思わない', 'どちらでもない', 'ややそう思う', 'そう思う'];

export const SURVEY = {
  title: 'マウス操作に関するアンケート',

  // 各ブロックの最初に1回だけ出す練習ページ（分析では練習として除外される）
  practice: [
    {
      id: 'practice',
      questions: [
        { id: 'P1', type: 'likert5', text: '今日は天気が良いと思う', options: AGREE5 },
        {
          id: 'P2', type: 'matrix', text: '次の食べ物はどのくらい好きですか',
          options: ['きらい', 'ややきらい', 'ふつう', 'やや好き', '好き'],
          rows: [{ id: 'P2_1', text: 'りんご' }, { id: 'P2_2', text: 'カレーライス' }]
        }
      ]
    }
  ],

  sets: {
    A: {
      title: 'ふだんのマウス操作について',
      pages: [
        {
          id: 'A-p1',
          questions: [
            { id: 'A01', type: 'likert5', text: 'クリックしたい場所へ、カーソルをすばやく動かせる', options: AGREE5 },
            { id: 'A02', type: 'likert5', text: '小さいボタンやリンクを押すのは得意だ', options: AGREE5 },
            { id: 'A03', type: 'likert5', text: '長い時間マウスを使うと、手や腕が疲れる', options: AGREE5 }
          ]
        },
        {
          id: 'A-p2',
          questions: [
            { id: 'A04', type: 'choice', text: 'ふだん一番よく使うポインティング機器はどれですか',
              options: ['マウス', 'タッチパッド', 'トラックボール', 'ペンタブレット', 'その他'] },
            { id: 'A05', type: 'grid', text: 'マウスのポインタ速度の設定はどれに近いですか',
              options: ['とても遅い', '遅い', 'ふつう', '速い', 'とても速い', 'わからない'] }
          ]
        },
        {
          id: 'A-p3',
          questions: [
            {
              id: 'A06', type: 'matrix', text: '次の操作は、あなたにとってどのくらい難しいですか',
              options: ['とても簡単', '簡単', 'ふつう', '難しい', 'とても難しい'],
              rows: [
                { id: 'A06_1', text: 'ダブルクリック' },
                { id: 'A06_2', text: 'ドラッグ＆ドロップ' },
                { id: 'A06_3', text: '文字をなぞって選ぶ' },
                { id: 'A06_4', text: '小さなチェックボックスを押す' }
              ]
            }
          ]
        },
        {
          id: 'A-p4',
          questions: [
            { id: 'A07', type: 'multi', text: 'マウスをよく使う作業をすべて選んでください',
              options: ['Webページを見る', '文書を作る', '表計算', 'ゲーム', '画像や動画の編集', 'プログラミング'] },
            { id: 'A08', type: 'likert7', text: 'いまのマウス操作はどのくらい快適ですか',
              options: ['1', '2', '3', '4', '5', '6', '7'], anchors: ['とても不快', 'とても快適'] }
          ]
        }
      ]
    },

    B: {
      title: 'カーソルとクリックの困りごとについて',
      pages: [
        {
          id: 'B-p1',
          questions: [
            { id: 'B01', type: 'likert5', text: '画面の上でカーソルを見失うことがある', options: AGREE5 },
            { id: 'B02', type: 'likert5', text: '押したいボタンの、となりのボタンを押してしまうことがある', options: AGREE5 },
            { id: 'B03', type: 'likert5', text: 'せまい場所に並んだリンクを選ぶのは手間だ', options: AGREE5 }
          ]
        },
        {
          id: 'B-p2',
          questions: [
            { id: 'B04', type: 'choice', text: 'マウスはどちらの手で持つことが多いですか',
              options: ['右手', '左手', '両方', '決まっていない', '答えたくない'] },
            { id: 'B05', type: 'grid', text: '1日にマウスを使う時間はどれくらいですか',
              options: ['30分未満', '30分〜1時間', '1〜3時間', '3〜6時間', '6時間以上', 'わからない'] }
          ]
        },
        {
          id: 'B-p3',
          questions: [
            {
              id: 'B06', type: 'matrix', text: '次の場面で、クリックし損ねることはありますか',
              options: ['まったくない', 'ほとんどない', 'ときどき', 'よくある', 'いつも'],
              rows: [
                { id: 'B06_1', text: 'メニューの項目を選ぶとき' },
                { id: 'B06_2', text: '地図の上のピンを押すとき' },
                { id: 'B06_3', text: '表の中のセルを選ぶとき' },
                { id: 'B06_4', text: 'ウィンドウの端をつかむとき' }
              ]
            }
          ]
        },
        {
          id: 'B-p4',
          questions: [
            { id: 'B07', type: 'multi', text: 'カーソル操作で困ったことがあるものをすべて選んでください',
              options: ['小さいボタン', '細いスクロールバー', '近くに並んだリンク', '動く広告', 'ドラッグ中のずれ', '特にない'] },
            { id: 'B08', type: 'likert7', text: 'クリックの正確さに、どのくらい自信がありますか',
              options: ['1', '2', '3', '4', '5', '6', '7'], anchors: ['まったくない', 'とてもある'] }
          ]
        }
      ]
    }
  }
};

// 質問の数え方：マトリクスは行ごとに1問
export function questionCount(pages) {
  let n = 0;
  for (const pg of pages) for (const q of pg.questions) n += q.type === 'matrix' ? q.rows.length : 1;
  return n;
}

// 2つのセットの「形」がそろっているかを確かめる。ずれていれば説明の配列を返す（そろっていれば空）
export function checkSetsMatch(survey = SURVEY) {
  const names = Object.keys(survey.sets);
  const problems = [];
  const shape = (set) => set.pages.map((pg) => pg.questions.map((q) =>
    `${q.type}:${q.options.length}${q.type === 'matrix' ? `x${q.rows.length}` : ''}`).join(','));
  const base = shape(survey.sets[names[0]]);
  for (const name of names.slice(1)) {
    const other = shape(survey.sets[name]);
    if (other.length !== base.length) problems.push(`${name} のページ数が ${names[0]} とちがいます`);
    other.forEach((p, i) => {
      if (p !== base[i]) problems.push(`${i + 1}ページ目の形がちがいます：${names[0]}=[${base[i]}] / ${name}=[${p}]`);
    });
  }
  const ids = new Set();
  const all = [...survey.practice, ...names.flatMap((n) => survey.sets[n].pages)];
  for (const pg of all) {
    for (const q of pg.questions) {
      for (const id of q.type === 'matrix' ? [q.id, ...q.rows.map((r) => r.id)] : [q.id]) {
        if (ids.has(id)) problems.push(`質問ID ${id} が重複しています`);
        ids.add(id);
      }
    }
  }
  return problems;
}

// 条件の順番と質問セットの割り当て（参加者IDの番号で4通りを順に回す＝カウンターバランス）
//   1: なし(A) → あり(B)   2: あり(A) → なし(B)   3: なし(B) → あり(A)   4: あり(B) → なし(A)
// 4人1組で、条件の順番とセットの組み合わせが全部そろう。
export function autoAssignment(pid) {
  const m = String(pid).match(/\d+/g);
  const n = m ? Number(m[m.length - 1]) : 1;
  const g = ((n - 1) % 4 + 4) % 4;
  const order = g % 2 === 0 ? ['off', 'on'] : ['on', 'off'];
  const sets = g < 2 ? ['A', 'B'] : ['B', 'A'];
  return { order, sets, group: g + 1 };
}
