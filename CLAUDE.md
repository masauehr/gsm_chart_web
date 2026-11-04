# CLAUDE.md — gsm_chart_web

## 概要
京大RISH の GSM GRIB2 から気象庁ビューア風の天気図PNGを作り、ブラウザで閲覧するアプリ。詳しくは [gsm-chart-web.md](gsm-chart-web.md)、設計は [DESIGN.md](DESIGN.md)。

## 実行環境
- Python: `/opt/anaconda3/envs/met_env_310/bin/python`（pygrib/cartopy/metpy/scipy/requests）。`python -I` は import できなくなるので使わない。
- 作成: `python make_charts.py --latest` / 閲覧: `python server.py`（既定 http://127.0.0.1:8780/）

## 規約
- コメント・UIは日本語。インデント: Python 4、JS/HTML/CSS 2。
- **tenkizu と共通部品化しない**（コピーして自己完結を保つ）。
- 図種は `gsm_charts.py` の `CHARTS`、地域は `REGIONS` に追加。追加したら README・マニュアル・pc_docs も更新。
- `data/` と `output/` はgit除外。GRIB2は1ファイル約33MB。

## 落とし穴
- numpy のスレッド競合で並列描画が桁違いに遅くなる → `gsm_charts.py` 冒頭でスレッド数1に固定済み（外さない）。
- 降水(APCP)は `name` が `unknown`。パラメータ番号で識別する。
- `#noData` のような `hidden` 属性は CSS の `display` に負ける。`[hidden]{display:none}` を併記する。
- ポート 8765 は他アプリが使用中のことがある。

## 画用紙版
`web/board/`（http://127.0.0.1:8780/board/）。通常版 `web/app.js` とは独立。操作は gsm-chart-web.md の表を参照。
