#!/usr/bin/env python
# coding: utf-8
"""GSM天気図の自動更新（定期実行用）。launchd などから1時間おきに呼ぶ想定。

動作:
  1. 最新の初期値から順に（既定3日前まで）RISHで「必要なファイルが max_ft まで全部揃っているか」を調べる
  2. 揃っていて、まだ作っていない最新の初期値を1つだけ選ぶ（公開途中の中途半端な作図を避ける）
  3. make_charts.py で ダウンロード → 作図 → manifest.json 更新
  4. --keep N のときだけ、古い初期値のGRIB2とPNGを削除（既定は削除しない）

使用例:
  python auto_update.py --dry-run              # 何をするかだけ表示
  python auto_update.py                        # 1回実行（FT0〜72h）
  python auto_update.py --keep 4 --jobs 3      # 最新4初期値だけ残す
  python auto_update.py ? / -? / --?           # ヘルプ

二重起動は output/.auto_update.lock で防ぐ。ログは logs/auto_update.log。
"""
import argparse
import os
import re
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import gsm_data
import gsm_charts

ROOT = Path(__file__).resolve().parent
OUTPUT_DIR = ROOT / "output"
LOCK = OUTPUT_DIR / ".auto_update.lock"
LOCK_STALE_SEC = 3 * 3600  # 3時間以上前のロックは異常終了の残骸とみなす


def log(msg):
    line = f"{datetime.now():%Y-%m-%d %H:%M:%S} {msg}"
    print(line, flush=True)


def parse_args():
    p = argparse.ArgumentParser(description="GSM天気図の自動更新",
                                formatter_class=argparse.RawDescriptionHelpFormatter, epilog=__doc__)
    p.add_argument("--max-ft", type=int, default=72, help="作成する最大予報時間[h]（既定: 72）")
    p.add_argument("--days-back", type=int, default=3, help="何日前の初期値まで探すか（既定: 3）")
    p.add_argument("--jobs", type=int, default=2, help="作図の並列数（既定: 2）")
    p.add_argument("--keep", type=int, default=0,
                   help="残す初期値の数。0（既定）なら古いデータを削除しない")
    p.add_argument("--data-dir", default=str(gsm_data.DEFAULT_DATA_DIR), help="GRIB2の保存先")
    p.add_argument("--dry-run", action="store_true", help="状況を表示するだけで何も取得・作図しない")
    p.add_argument("--force", action="store_true", help="作成済みの初期値でも作り直す")
    if any(a in sys.argv[1:] for a in ("?", "-?", "--?")):
        p.print_help()
        sys.exit(0)
    return p.parse_args()


def acquire_lock():
    """二重起動防止。取れなければ False。"""
    OUTPUT_DIR.mkdir(exist_ok=True)
    if LOCK.exists():
        age = time.time() - LOCK.stat().st_mtime
        if age < LOCK_STALE_SEC:
            return False
        log(f"古いロック（{age / 3600:.1f}時間前）を無視して続行")
    LOCK.write_text(str(os.getpid()))
    return True


def built_fts(init_s):
    """output/ に既にある、この初期値のFT（全地域の和集合）。"""
    d = OUTPUT_DIR / init_s
    fts = set()
    if d.is_dir():
        for f in d.glob("*/*_*.png"):
            m = re.fullmatch(r"\w+?_(\d{3})\.png", f.name)
            if m:
                fts.add(int(m.group(1)))
    return fts


def is_built(init_s, max_ft):
    """この初期値は max_ft まで作図済みか（3時間毎の地域があるため3の倍数が全部あること）。"""
    have = built_fts(init_s)
    return all(ft in have for ft in range(0, max_ft + 1, 3))


def candidate_inits(days_back):
    """新しい順の初期値候補（00/06/12/18UTC）。"""
    now = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    now -= timedelta(hours=now.hour % 6)
    return [now - timedelta(hours=6 * i) for i in range(days_back * 4 + 1)]


def prune(keep, data_dir):
    """最新 keep 個の初期値以外の GRIB2 と PNG を削除する（ファイル単位。ディレクトリごと消さない）。"""
    inits = sorted([d.name for d in OUTPUT_DIR.iterdir() if d.is_dir() and re.fullmatch(r"\d{10}", d.name)],
                   reverse=True)
    old = set(inits[keep:])
    n = 0
    for init_s in old:
        d = OUTPUT_DIR / init_s
        for f in list(d.glob("*/*.png")):
            f.unlink()
            n += 1
        for sub in list(d.iterdir()):
            if sub.is_dir():
                try:
                    sub.rmdir()
                except OSError:
                    pass
        try:
            d.rmdir()
        except OSError:
            pass
    for f in Path(data_dir).glob("Z__C_RJTD_*_GSM_GPV_*"):
        m = re.match(r"Z__C_RJTD_(\d{10})0000_", f.name)
        if m and m.group(1) in old:
            f.unlink()
            n += 1
    for f in Path(data_dir).glob("*.part"):  # 中断したダウンロードの残骸
        if time.time() - f.stat().st_mtime > 3600:
            f.unlink()
    log(f"古い初期値 {len(old)} 件を整理（削除ファイル {n} 個）")


def main():
    a = parse_args()
    if not a.dry_run and not acquire_lock():
        log("別の自動更新が実行中のため終了します")
        return
    try:
        target = None
        for init in candidate_inits(a.days_back):
            init_s = f"{init:%Y%m%d%H}"
            if not a.force and is_built(init_s, a.max_ft):
                log(f"{init_s}: 作成済み → これより古い初期値は見ずに終了")
                break
            st = gsm_data.remote_status(init, a.max_ft)
            if st["complete"]:
                target = init
                break
            log(f"{init_s}: RISH側が未完了（Rgl欠落 {len(st['rgl_missing'])}、Rjp欠落 {len(st['rjp_missing'])}）→ 次の候補へ")
        if target is None:
            log("新しく作成できる初期値はありません")
        else:
            init_s = f"{target:%Y%m%d%H}"
            log(f"{init_s}: 取得・作図を開始（FT0〜{a.max_ft}h）{'[dry-run]' if a.dry_run else ''}")
            if not a.dry_run:
                cmd = [sys.executable, str(ROOT / "make_charts.py"), init_s, "--max-ft", str(a.max_ft),
                       "--jobs", str(a.jobs), "--data-dir", a.data_dir]
                r = subprocess.run(cmd, cwd=ROOT)
                log(f"{init_s}: make_charts 終了コード {r.returncode}")
        if a.keep > 0 and not a.dry_run:
            prune(a.keep, a.data_dir)
    finally:
        if not a.dry_run:
            LOCK.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
