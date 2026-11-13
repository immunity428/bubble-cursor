"""区間データ(CSV)を参加者・条件ごとにまとめ、バブルなし/ありを対応ありで比較する。

使い方:
    python analysis/aggregate.py data/*_segments.csv          # ブラウザで保存したCSV
    python analysis/aggregate.py all_segments.csv             # segments-from-json.js の出力
    python analysis/aggregate.py data/*_segments.csv data/*_aim.csv   # エイムの命中数も比較する
出力（out/ フォルダ）:
    per_participant.csv   参加者 × 課題（アンケート／エイム）× 条件ごとの中央値
    comparison.csv        課題・指標ごとの Wilcoxon 符号順位検定（対応あり）
    boxplots.png          参加者ごとの中央値を条件で並べた図

必要なもの: pandas, scipy, matplotlib
"""
import sys
from pathlib import Path

import pandas as pd

METRICS = {
    'time_total_ms': '区間時間 (ms)',
    'time_final_move_ms': '最後の移動時間 (ms)',
    'speed_active_px_s': '平均速度 (px/s)',
    'speed_peak_px_s': '最大速度 (px/s)',
    'path_px': '経路長 (px)',
    'straightness': '直進度',
    'throughput_bps': 'スループット (bit/s)',
}
TASK_LABEL = {'survey': 'アンケート', 'aim': 'エイム'}


def load(paths):
    frames = [pd.read_csv(p, encoding='utf-8-sig') for p in paths]
    # エイム成績CSV（hits 列がある）と区間CSVを分ける
    aim = [f for f in frames if 'hits' in f.columns]
    frames = [f for f in frames if 'hits' not in f.columns]
    aim = pd.concat(aim, ignore_index=True) if aim else None
    df = pd.concat(frames, ignore_index=True).drop_duplicates(
        subset=['participant', 'condition', 'seg'])
    df['included'] = df['included'].astype(str).str.lower() == 'true'
    if 'task' not in df:          # 古いバージョンのCSV
        df['task'] = 'survey'
    for col in ('throughput_bps', 'wrong_selections'):
        if col not in df:
            df[col] = pd.NA
    return df, aim


def main(paths):
    df, aim = load(paths)
    use = df[df['included']]
    print(f'{df.participant.nunique()} 人、区間 {len(df)} 個（集計に使うのは {len(use)} 個）')

    per = use.groupby(['participant', 'task', 'condition', 'block']).agg(
        n_segments=('seg', 'count'),
        miss_clicks=('miss_clicks', 'sum'),
        wrong_selections=('wrong_selections', 'sum'),
        bubble_assisted=('via', lambda s: (s == 'bubble').sum()),
        **{m: (m, 'median') for m in METRICS},
    ).reset_index()

    out = Path('out')
    out.mkdir(exist_ok=True)
    per.to_csv(out / 'per_participant.csv', index=False, encoding='utf-8-sig')

    rows = []
    try:
        from scipy.stats import wilcoxon
    except ImportError:
        wilcoxon = None
    wides = {}
    for task, sub in per.groupby('task'):
        wide = sub.pivot(index='participant', columns='condition',
                         values=list(METRICS) + ['miss_clicks', 'wrong_selections'])
        wides[task] = wide
        for m in list(METRICS) + ['miss_clicks', 'wrong_selections']:
            if ('off' not in wide[m]) or ('on' not in wide[m]):
                continue
            pair = wide[m][['off', 'on']].apply(pd.to_numeric, errors='coerce').dropna()
            if pair.empty:
                continue
            rows.append(compare(task, m, pair, wilcoxon))
    # エイム課題の成績（制限時間内の命中数など）。*_aim.csv を渡したときだけ
    if aim is not None:
        aim = aim[aim['practice'].astype(str).str.lower() != 'true']
        for m in ('hits', 'accuracy', 'hits_per_s', 'wrong_selections', 'miss_clicks'):
            pair = aim.pivot_table(index='participant', columns='condition', values=m, aggfunc='mean')
            if {'off', 'on'} <= set(pair.columns):
                rows.append(compare('aim_round', m, pair[['off', 'on']].dropna(), wilcoxon))
    comp = pd.DataFrame(rows)
    comp.to_csv(out / 'comparison.csv', index=False, encoding='utf-8-sig')
    print(comp.to_string(index=False))
    if per.participant.nunique() < 6:
        print('※ 参加者が6人未満なので検定は省略しています')

    try:
        import matplotlib
        matplotlib.use('Agg')
        import matplotlib.pyplot as plt
        plt.rcParams['font.family'] = ['Hiragino Sans', 'Yu Gothic', 'Noto Sans CJK JP', 'IPAexGothic', 'sans-serif']
        tasks = list(wides)
        fig, axes = plt.subplots(len(tasks), len(METRICS), figsize=(3.2 * len(METRICS), 3.6 * len(tasks)),
                                 squeeze=False)
        for ti, task in enumerate(tasks):
            sub = per[per.task == task]
            for ax, (m, label) in zip(axes[ti], METRICS.items()):
                data = [pd.to_numeric(sub.loc[sub.condition == c, m], errors='coerce').dropna() for c in ('off', 'on')]
                if not any(len(d) for d in data):
                    ax.axis('off')
                    continue
                ax.boxplot(data, widths=0.5)
                ax.set_xticks([1, 2], ['なし', 'あり'])
                # 同じ参加者を線で結ぶ
                for _, r in wides[task][m].apply(pd.to_numeric, errors='coerce').dropna().iterrows():
                    ax.plot([1, 2], [r['off'], r['on']], color='0.7', lw=0.8, zorder=0)
                ax.set_title(f'{TASK_LABEL.get(task, task)}：{label}', fontsize=10)
        fig.tight_layout()
        fig.savefig(out / 'boxplots.png', dpi=150)
    except Exception as e:  # 図が作れなくても表は出す
        print('図の作成をスキップ:', e)
    print(f'保存先: {out.resolve()}')


def compare(task, m, pair, wilcoxon):
    row = {'task': task, 'metric': m, 'n': len(pair),
           'off_median': pair['off'].median(), 'on_median': pair['on'].median(),
           'diff_median(on-off)': (pair['on'] - pair['off']).median()}
    if wilcoxon and len(pair) >= 6 and (pair['on'] != pair['off']).any():
        res = wilcoxon(pair['on'], pair['off'])
        row.update({'W': res.statistic, 'p': res.pvalue})
    return row


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    main(sys.argv[1:])
