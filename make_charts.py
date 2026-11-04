#!/usr/bin/env python
# coding: utf-8
"""GSM天気図の一括作成CLI（取得 → 描画 → マニフェスト更新）。

使用例:
  python make_charts.py --latest                       # RISHの最新初期値を取得し FT0〜72h を全図種・全地域で作成
                                                       #   （Rgl系の地域は6時間毎、Rjp系 japan3/okinawa3 は3時間毎）
  python make_charts.py 2026110318 --max-ft 24         # 初期値指定・FT0〜24h
  python make_charts.py --latest --charts surf z500 --regions japan --jobs 4
  python make_charts.py --manifest-only                # output/ を走査して manifest.json だけ更新
  python make_charts.py ? / -? / --?                   # ヘルプ
"""
import argparse
import json
import os
import re
import sys
from concurrent.futures import ProcessPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

import gsm_data
import gsm_charts

ROOT = Path(__file__).resolve().parent
OUTPUT_DIR = ROOT / "output"


def parse_args():
    p = argparse.ArgumentParser(
        description="GSM GRIB2（京大RISH）から天気図PNGを作成する",
        formatter_class=argparse.RawDescriptionHelpFormatter, epilog=__doc__)
    p.add_argument("init_time", nargs="?", help="初期時刻 YYYYMMDDHH（UTC）。--latest 指定時は省略可")
    p.add_argument("--latest", action="store_true", help="RISH上の最新初期値を自動検索する")
    p.add_argument("--max-ft", type=int, default=72, help="作成する最大予報時間[h]（既定: 72）")
    p.add_argument("--min-ft", type=int, default=0, help="作成する最小予報時間[h]（既定: 0）")
    p.add_argument("--interval", type=int, default=3,
                   help="FT間隔[h]（既定: 3）。Rgl系の地域は6の倍数のFTだけ、Rjp系は3の倍数のFTを作る")
    p.add_argument("--charts", nargs="+", default=list(gsm_charts.CHARTS),
                   choices=list(gsm_charts.CHARTS), help="図種（既定: 全部）")
    p.add_argument("--regions", nargs="+", default=list(gsm_charts.REGIONS),
                   choices=list(gsm_charts.REGIONS), help="地域（既定: 全部）")
    p.add_argument("--data-dir", default=str(gsm_data.DEFAULT_DATA_DIR),
                   help="GRIB2の保存先（既定: data/gsm）。tenkizuのdata_gsmも指定可")
    p.add_argument("--jobs", type=int, default=2, help="並列数（FT単位、既定: 2）")
    p.add_argument("--no-download", action="store_true", help="ダウンロードせず手元のファイルだけ使う")
    p.add_argument("--manifest-only", action="store_true", help="manifest.json の更新だけ行う")
    if any(a in sys.argv[1:] for a in ("?", "-?", "--?")):
        p.print_help()
        sys.exit(0)
    return p.parse_args()


def _render_ft(args):
    """1つのFT分（全図種・全地域）を描画する。サブプロセスで実行される。"""
    init_s, ft, charts, regions, data_dir = args
    init = gsm_data.parse_init(init_s)
    cache = {}  # データ系統ごとに1回だけ読む

    def fields(src):
        if src not in cache:
            if src == "rjp":
                cache[src] = gsm_data.load_fields_rjp(Path(data_dir), init, ft)
            else:
                path = Path(data_dir) / gsm_data.gsm_filename(init, ft)
                prev = Path(data_dir) / gsm_data.gsm_filename(init, ft - 6)
                cache[src] = (gsm_data.load_fields(path, prev if ft > 6 else None)
                              if ft % 6 == 0 and path.exists() else None)
        return cache[src]

    n = 0
    for region in regions:
        src = gsm_charts.REGIONS[region].get("src", "rgl")
        F = fields(src)
        if F is None:
            continue
        d = OUTPUT_DIR / init_s / region
        d.mkdir(parents=True, exist_ok=True)
        for chart in charts:
            if any(lv not in F["p"] for lv in gsm_charts.CHARTS[chart].get("levels", [])):
                continue  # この系統に無い気圧面（例: Rglの975hPa）はスキップ
            try:
                gsm_charts.render_chart(chart, region, F, init, ft, d / f"{chart}_{ft:03d}.png")
                n += 1
            except Exception as e:  # 1枚の失敗で全体を止めない
                print(f"  失敗: {init_s} FT{ft} {region}/{chart}: {e!r}")
    return ft, n, "ok" if n else "データなし"


def write_manifest():
    """output/ を走査して output/manifest.json を作る（Webアプリはこれを読む）。"""
    inits = []
    for d in sorted(OUTPUT_DIR.iterdir(), reverse=True):
        if not (d.is_dir() and re.fullmatch(r"\d{10}", d.name)):
            continue
        regions = {}
        for rd in sorted(d.iterdir()):
            if not rd.is_dir() or rd.name not in gsm_charts.REGIONS:
                continue
            charts = {}
            for f in rd.glob("*_*.png"):
                m = re.fullmatch(r"(\w+?)_(\d{3})\.png", f.name)
                if m and m.group(1) in gsm_charts.CHARTS:
                    charts.setdefault(m.group(1), []).append(int(m.group(2)))
            if charts:
                regions[rd.name] = {c: sorted(v) for c, v in sorted(charts.items())}
        if regions:
            inits.append({"init": d.name, "regions": regions})
    manifest = {
        "updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "charts": {k: v["label"] for k, v in gsm_charts.CHARTS.items()},
        "regions": {k: v["label"] for k, v in gsm_charts.REGIONS.items()},
        "inits": inits,
    }
    OUTPUT_DIR.mkdir(exist_ok=True)
    (OUTPUT_DIR / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"manifest.json 更新: 初期値 {len(inits)} 件")


def main():
    a = parse_args()
    if a.manifest_only:
        write_manifest()
        return
    data_dir = Path(a.data_dir)

    if a.latest or not a.init_time:
        init, fts = gsm_data.find_latest_init()
        if init is None:
            print("RISHから最新の初期値を見つけられませんでした")
            sys.exit(1)
        print(f"最新初期値: {init:%Y-%m-%d %H}UTC（RISH上のFT {len(fts)} 個）")
    else:
        init = gsm_data.parse_init(a.init_time)
    init_s = f"{init:%Y%m%d%H}"

    ft_list = list(range(a.min_ft, a.max_ft + 1, a.interval))
    srcs = {gsm_charts.REGIONS[r].get("src", "rgl") for r in a.regions}
    if not a.no_download:
        if "rgl" in srcs:
            rgl_fts = [ft for ft in ft_list if ft % 6 == 0]
            # 直前6h降水の差分用に、最初のFTの6時間前も取る
            need = ([rgl_fts[0] - 6] if rgl_fts and rgl_fts[0] >= 12 else []) + rgl_fts
            print(f"ダウンロード(Rgl 全球0.5°): FT {len(rgl_fts)} 個（1つ約33MB）")
            for ft in need:
                gsm_data.download(init, ft, data_dir)
        if "rjp" in srcs:
            print("ダウンロード(Rjp 日本域0.125°): 24時間分ごとのファイル（等圧面約40MB＋地上約18MB）")
            gsm_data.download_rjp(init, ft_list, data_dir)
    print(f"描画: FT {len(ft_list)} 個 × 地域 {len(a.regions)} × 図種 {len(a.charts)}（データのある組み合わせのみ）")

    tasks = [(init_s, ft, a.charts, a.regions, str(data_dir)) for ft in ft_list]
    if a.jobs > 1:
        with ProcessPoolExecutor(max_workers=a.jobs) as ex:
            results = list(ex.map(_render_ft, tasks))
    else:
        results = [_render_ft(t) for t in tasks]
    total = sum(r[1] for r in results)
    for ft, n, msg in results:
        if msg != "ok":
            print(f"  FT{ft}: {msg}")  # 該当FTに描けるデータが無い（例: 3の倍数でない/Rgl欠落）
    print(f"完了: {total} 枚 → {OUTPUT_DIR / init_s}")
    write_manifest()


if __name__ == "__main__":
    main()
