# gsm_chart_web — GSM天気図Webビューア

詳しくは [gsm-chart-web.md](gsm-chart-web.md) を参照。設計・ロードマップは [DESIGN.md](DESIGN.md)。

気象庁全球モデル（GSM）の GRIB2（京都大学 RISH 配信）から、気象庁内部ビューア風の天気図を作成し、ブラウザで閲覧するアプリ。

## クイックスタート

```bash
cd ~/projects/gsm_chart_web
conda activate met_env_310
python make_charts.py --latest      # 最新初期値を取得して作図（FT0〜72h）
python server.py                    # → http://127.0.0.1:8780/
```

## 画面

- 通常版: <http://127.0.0.1:8780/> … 1枚ずつ閲覧
- 画用紙版: <http://127.0.0.1:8780/board/> … 各高度の図を並べ、マウスで移動・拡大縮小、↑↓キーで予報時間を前後

## 図種・地域

- 図種: 地上 / 500hPa / 300hPa / 850hPa / 700hPa / 925hPa / 850hPa EPT・SSI
- 地域: 日本周辺 / 沖縄周辺 / 東アジア広域

## データ出典

気象庁 全球モデル(GSM) GPV を京都大学生存圏研究所 RISH のアーカイブから取得。
