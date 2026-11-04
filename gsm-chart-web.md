# gsm_chart_web — GSM天気図Webビューア マニュアル

気象庁全球モデル（GSM）の GRIB2 を京都大学 RISH から取得し、気象庁内部ビューア風の天気図 PNG を作成して、ブラウザで見るアプリ。
作成日: 2026-11-04（v0.1）

## 何ができるか

- RISH から最新（または指定）の初期値の GSM GRIB2 を自動ダウンロード
- 7 図種 × 3 地域 × 予報時間（既定 FT=0〜72h, 6 時間ごと）の PNG を作成
- ブラウザで 初期値・地域・図種を切り替え、予報時間をスライダー／キー／アニメーションで閲覧

| 図種（chart） | 内容 | 風 |
|---|---|---|
| `surf` | 地上: 海面気圧・H/L・直前6時間平均降水(mm/h) | 10m風(赤) |
| `z500` | 500hPa 高度（60m毎）・相対渦度（≥40 を斜線） | なし |
| `jet300` | 300hPa 高度・気温・等風速(≥60kt 黄色) | 紺 |
| `t850` | 850hPa 気温・湿数（3℃未満を斜線） | 赤 |
| `t700` | 700hPa 気温・湿数・上昇流ω(<-10hPa/h を点) | 赤 |
| `t925` | 925hPa 気温・湿数 | 赤 |
| `ept850` | 850hPa 相当温位・SSI(500-850)・風 | 赤 |

| 地域（region） | 投影 | 範囲の目安 |
|---|---|---|
| `japan` 日本周辺 | ランベルト | 幅約4400km |
| `okinawa` 沖縄周辺 | 正距円筒 | 経度幅24° |
| `asia` 東アジア広域 | ランベルト | 幅約8600km |

## 使い方

実行環境は tenkizu と同じ conda 環境（pygrib / cartopy / metpy / scipy / requests が必要）。

```bash
cd ~/projects/gsm_chart_web
conda activate met_env_310      # または /opt/anaconda3/envs/met_env_310/bin/python を直接指定

# 1) 最新初期値を取得して全部作る（FT0〜72h: 13ファイル ≒ 430MB、並列2で10分前後）
python make_charts.py --latest

# 2) 閲覧サーバーを起動 → http://127.0.0.1:8780/
python server.py
```

よく使う指定:

```bash
python make_charts.py 2026110318 --max-ft 24                # 初期値指定・FT0〜24h
python make_charts.py --latest --charts surf z500 --regions japan --jobs 4
python make_charts.py 2026110318 --data-dir ../tenkizu/data_gsm --no-download   # tenkizuのDL済みデータを使う
python make_charts.py --manifest-only                       # manifest.json だけ更新
python make_charts.py ?                                     # ヘルプ
```

ブラウザ操作: ←→ 予報時間 / ↑↓ 図種 / Space 再生 / Home・End 最初・最後。URL の `#init=..&region=..&chart=..&ft=..` を保存すれば同じ画面を再現できる。

## ファイル構成

| パス | 役割 |
|---|---|
| `gsm_data.py` | RISH からの取得（最新初期値の検索・ダウンロード）と GRIB2 読み込み・単位変換 |
| `gsm_charts.py` | 図の描画（地域・図種の定義、見出し・凡例・枠） |
| `make_charts.py` | CLI。取得 → FT単位で並列描画 → `output/manifest.json` 更新 |
| `server.py` | 標準ライブラリの静的サーバー（`/`=web/、`/output/`=output/） |
| `web/` | `index.html` / `style.css` / `app.js`（Vanilla JS、フレームワーク不使用） |
| `data/gsm/` | GRIB2（git除外） |
| `output/{初期値}/{地域}/{図種}_{FT3桁}.png` | 作成画像（git除外）。`output/manifest.json` が一覧 |

## 仕様メモ・注意

- GSM の Rgl ファイルは **0.5°格子・等圧面は 925/850/700/500/300hPa ほか**。975hPa や 500m 面（サンプル画像にある）は含まれないため未対応。
- 降水は GRIB2 の積算降水量（APCP, 初期時刻からの積算）の **差分÷6h**。変数名が `unknown` になるため、パラメータ番号（カテゴリ1・番号8）で識別している。FT=0 には降水が無い。
- 地面より下の等圧面（例: チベット高原の 700hPa）は地表気圧でマスクする。
- SSI は 850hPa の湿球温位から湿潤断熱線を引いて 500hPa 気温と比較（対応表を一度だけ作り補間）。
- 初期値: RISH では 00/06/12/18UTC がある。ダウンロードは公開直後に欠けることがあるので、`--latest` は FT が5個以上揃った最新初期値を選ぶ。
- ポート 8765 は他のアプリが使っていることがあるため、既定は **8780**。
- numpy のスレッド競合で並列描画が極端に遅くなる（5分→28秒）ため、`gsm_charts.py` で各種スレッド数を 1 に固定している。
- 気象庁 GPV の利用は出典明記（本アプリ画面下部に記載）。

## 既知の制約・今後

→ [DESIGN.md](DESIGN.md) を参照。
