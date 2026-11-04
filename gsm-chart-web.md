# gsm_chart_web — GSM天気図Webビューア マニュアル

気象庁全球モデル（GSM）の GRIB2 を京都大学 RISH から取得し、気象庁内部ビューア風の天気図 PNG を作成して、ブラウザで見るアプリ。
作成日: 2026-11-04（v0.1）

## 何ができるか

- RISH から最新（または指定）の初期値の GSM GRIB2 を自動ダウンロード
- 10 図種 × 5 地域 × 予報時間（既定 FT=0〜72h）の PNG を作成。全球(Rgl)系の地域は 6 時間毎、日本域(Rjp)系の地域は **3 時間毎**
- ブラウザで 初期値・地域・図種を切り替え、予報時間をスライダー／キー／アニメーションで閲覧

| 図種（chart） | 内容 | 風 |
|---|---|---|
| `surf` | 地上: 海面気圧・H/L・降水（Rgl: 直前6時間平均、Rjp: 直前1時間 `RR1`） mm/h | 10m風(赤) |
| `tenki` | 地上: 天気（全雲量で晴/薄曇/曇、降水で雨を緑）・海面気圧・SSI(700-850)<0 の点・H/L | 10m風(赤) |
| `z500` | 500hPa 高度（60m毎）・相対渦度（≥40 を斜線） | なし |
| `jet300` | 300hPa 高度・気温・等風速(≥60kt 黄色) | 紺 |
| `t500` | 500hPa 気温・湿数・風 | 赤 |
| `t850` | 850hPa 気温・湿数（3℃未満を斜線） | 赤 |
| `t700` | 700hPa 気温・湿数・上昇流ω(<-10hPa/h を点) | 赤 |
| `t925` | 925hPa 気温・湿数 | 赤 |
| `t975` | 975hPa 気温・湿数・風（**日本域 Rjp のみ**） | 赤 |
| `ept850` | 850hPa 相当温位・SSI(500-850)・風 | 赤 |

| 地域（region） | 投影 | 範囲の目安 |
|---|---|---|
| `japan` 日本周辺 | ランベルト | 幅約4400km |
| `okinawa` 沖縄周辺 | 正距円筒 | 経度幅24° |
| `asia` 東アジア広域 | ランベルト | 幅約8600km |
| `japan3` 日本域（0.125°・3時間毎） | ランベルト | 幅約2700km（データ範囲 120-150E, 20-50N 内） |
| `okinawa3` 南西域（0.125°・3時間毎） | 正距円筒 | 経度幅26° |

`japan` / `okinawa` / `asia` は全球 Rgl（0.5°・6時間毎）、`japan3` / `okinawa3` は日本域 Rjp（0.125°・3時間毎）から作る。

## 使い方

実行環境は tenkizu と同じ conda 環境（pygrib / cartopy / metpy / scipy / requests が必要）。

```bash
cd ~/projects/gsm_chart_web
conda activate met_env_310      # または /opt/anaconda3/envs/met_env_310/bin/python を直接指定

# 1) 最新初期値を取得して全部作る（Rgl 13ファイル≒430MB ＋ Rjp 3日分≒180MB）
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

## 随時ダウンロード（画面の「最新を取得」ボタン）

通常版・画用紙版のヘッダーにある **「最新を取得」** を押すと、サーバーが `auto_update.py` を裏で実行し、RISH の最新の（FT72hまで揃った）初期値を取得して作図する。進捗は画面に表示され、完了すると一覧が再読み込みされて新しい初期値に切り替わる。

- 取得済みなら「作成済み」と判定して何もしない。公開途中（FTが揃っていない）の初期値は飛ばして1つ前を使う。
- 実行中は二重に起動しない。ログは `logs/update_ui.log`（毎回上書き）。
- API: `POST /api/update`（開始）、`GET /api/status`（状態）。**ローカル（127.0.0.1/::1）からのみ**受け付け、Origin が同一ホストでないPOSTは 403。`--host 0.0.0.0` でLAN公開しても他端末からは実行できない。
- サーバーを動かしている Python が更新も実行する（conda の met_env_310 で `server.py` を起動すること）。
- 初回は Rgl 約430MB＋Rjp 約180MB を取得するため数分〜十数分かかる。

## 自動ダウンロード・自動更新（`auto_update.py` ＋ launchd。現在は未登録）

**定期実行は現在使っていない（launchd は登録していない）。** 上のボタン（随時取得）が主な使い方で、定期実行は機能として残してある。

RISH に新しい初期値（00/06/12/18UTC）が公開されたら、自動で取得して作図する。

```bash
python auto_update.py --dry-run     # 何をするかだけ表示（取得・作図しない）
python auto_update.py               # 1回実行
python auto_update.py --keep 4      # 最新4初期値だけ残し、古いGRIB2とPNGをファイル単位で削除（既定は削除しない）
```

- 新しい初期値から順に、RISH 上で **必要なファイルが max_ft まで全部揃っているか**（Rgl 6時間毎・Rjp 3時間毎）を確認。公開の途中なら作らずに次の実行を待つ。
- 作成済み（FT0〜max_ft が全て output/ にある）の初期値が最新なら何もしない。
- 二重起動は `output/.auto_update.lock` で防ぐ（3時間以上前のロックは残骸とみなす）。ログは `logs/auto_update.log`。
- 取得・作図は `make_charts.py` を呼ぶだけなので、手動実行と同じ結果になる。

### launchd で定期実行（1時間おき）

`launchd/com.masahiro.gsm_chart_web.plist` に雛形がある（condaのPythonを絶対パス指定、`--keep 4 --jobs 3`）。**登録は手動で行う**（システム設定の変更になるため自動では入れない）。

```bash
cp launchd/com.masahiro.gsm_chart_web.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.masahiro.gsm_chart_web.plist
launchctl list | grep gsm_chart_web              # 登録確認
launchctl kickstart gui/$(id -u)/com.masahiro.gsm_chart_web   # 今すぐ1回実行
# 解除
launchctl bootout gui/$(id -u)/com.masahiro.gsm_chart_web
```

注意: Mac がスリープ中は実行されない。ブラウザは再読み込み（または画面の初期値セレクトを開き直す）で新しい初期値を拾う。brew 更新で python3 が切り替わっても影響を受けないよう、plist は conda の Python を直接指定している。

## 画用紙版（複数の図を並べて表示）: `http://127.0.0.1:8780/board/`

webTGVmonitor の操作感に合わせた別ページ（通常版とは独立。通常版ヘッダーの「画用紙版」リンクからも開ける）。
各高度の図を画用紙（画面）に並べ、マウスで位置・大きさを調整し、キーボードで時間を前後させる。

| 操作 | 内容 |
|---|---|
| ↑ / ↓ | 予報時間 +6h / −6h（Ctrl+↓: 0h、Ctrl+↑: 最大） |
| ← / → | 初期時刻を 前 / 次（Ctrl+←→: 予報有効時刻を固定して初期値を変える） |
| マウスホイール | 図の上で拡大縮小（0.25〜2倍、カーソル位置を基準） |
| タイトル帯ドラッグ | 図を移動（クリックで最前面） |
| 右下▨ドラッグ | 図の大きさを変更（縦横比固定） |
| B | 最後に触った図を最背面へ |
| P / S | 再生 / 停止（矢印キーでも停止） |
| T / I | 整列 / 配置の初期化 |
| D / H | 上部バーの表示切替 / 使い方 |

既定の並びは **左上が最も高い高度（300hPa）、右下が地上（surf）**（300 → 500 → 700 → 850 → 925 → 地上。整列 T で再配置）。表示する図の ON/OFF は上部バーのボタン、地域・初期値はセレクトで切り替える。配置・大きさ・表示図はブラウザの localStorage に自動保存（`gsmBoard.v1`）。
実装は `web/board/`（`index.html` / `board.css` / `board.js`）。画像規則・manifest は通常版と共通。

## ファイル構成

| パス | 役割 |
|---|---|
| `gsm_data.py` | RISH からの取得（最新初期値の検索・Rgl/Rjp ダウンロード）と GRIB2 読み込み・単位変換 |
| `gsm_charts.py` | 図の描画（地域・図種の定義、見出し・凡例・枠） |
| `make_charts.py` | CLI。取得 → FT単位で並列描画 → `output/manifest.json` 更新 |
| `auto_update.py` | 新しい初期値の検知 → `make_charts.py` 呼び出し → 古いデータ整理（定期実行用） |
| `launchd/` | 自動更新用 launchd plist 雛形 |
| `server.py` | 標準ライブラリの静的サーバー（`/`=web/、`/output/`=output/） |
| `web/` | 通常版 `index.html` / `style.css` / `app.js`（Vanilla JS、フレームワーク不使用） |
| `web/board/` | 画用紙版 `index.html` / `board.css` / `board.js` |
| `data/gsm/` | GRIB2（git除外） |
| `output/{初期値}/{地域}/{図種}_{FT3桁}.png` | 作成画像（git除外）。`output/manifest.json` が一覧 |

## 仕様メモ・注意

- **Rgl（全球 0.5°）**: 等圧面は 925/850/700/500/300hPa ほか。975hPa は無い。6時間毎。
- **Rjp（日本域 0.125°、`GSM_GPV_Rjp_Gll0p1deg_{L-pall|Lsurf}`）**: 120-150E, 20-50N。**3時間毎**、975hPa あり、地上は1時間毎で1時間降水が作れる。24時間分が1ファイル（等圧面約40MB＋地上約18MB）。ファイル名の `FD0103-0200` のような範囲で FT を引き当てる。
- 500m 面（FLWV）とレーダーは未対応。
- `tenki` の閾値: 雲量 30%/70% で晴・薄曇・曇、雨は 1時間降水0.5mm（Rglの6時間平均は0.2mm/h）以上。JMA 内部ビューアの正確な定義ではなく見た目を寄せた近似。
- H/L の検出窓は度数で指定（格子間隔が違っても同じ広さ）。0.125°では平滑化してから探す。
- 降水は GRIB2 の積算降水量（APCP, 初期時刻からの積算）の **差分÷6h**。変数名が `unknown` になるため、パラメータ番号（カテゴリ1・番号8）で識別している。FT=0 には降水が無い。
- 地面より下の等圧面（例: チベット高原の 700hPa）は地表気圧でマスクする。
- SSI は 850hPa の湿球温位から湿潤断熱線を引いて 500hPa 気温と比較（対応表を一度だけ作り補間）。
- 初期値: RISH では 00/06/12/18UTC がある。ダウンロードは公開直後に欠けることがあるので、`--latest` は FT が5個以上揃った最新初期値を選ぶ。
- ポート 8765 は他のアプリが使っていることがあるため、既定は **8780**。
- numpy のスレッド競合で並列描画が極端に遅くなる（5分→28秒）ため、`gsm_charts.py` で各種スレッド数を 1 に固定している。
- 気象庁 GPV の利用は出典明記（本アプリ画面下部に記載）。

## 既知の制約・今後

→ [DESIGN.md](DESIGN.md) を参照。
