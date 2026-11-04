#!/usr/bin/env python
# coding: utf-8
"""GSM GRIB2 の取得（京都大学 RISH）と読み込み。

データ提供元: 京都大学生存圏研究所 (RISH) 気象庁データアーカイブ
  http://database.rish.kyoto-u.ac.jp/arch/jmadata/data/gpv/original/
ファイル名: Z__C_RJTD_{YYYYMMDDHH}0000_GSM_GPV_Rgl_FD{DDHH}_grib2.bin
  FD{DDHH} の DD=日, HH=時 → FT[h] = DD*24 + HH
"""
import os
import re
import sys

# pygrib/cartopy より前に PROJ のデータ場所を指定（conda 環境で必要になることがある）
_proj = os.path.join(sys.prefix, "share", "proj")
if os.path.isdir(_proj):
    os.environ.setdefault("PROJ_LIB", _proj)

from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

BASE_URL = "http://database.rish.kyoto-u.ac.jp/arch/jmadata/data/gpv/original"
HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; GSM-Chart-Web/0.1)"}
DEFAULT_DATA_DIR = Path(__file__).resolve().parent / "data" / "gsm"

# GSM(Rgl) の予報時間（時間）。0〜84h は6時間間隔（00/12UTC初期値は〜264hまで12h間隔）
FT_STEP = 6


def ft_to_ddhh(ft: int) -> int:
    """予報時間[h] → FD の DDHH 数値（例: 18h→18, 24h→100, 36h→112）"""
    return (ft // 24) * 100 + (ft % 24)


def ddhh_to_ft(ddhh: int) -> int:
    return (ddhh // 100) * 24 + (ddhh % 100)


def gsm_filename(init: datetime, ft: int) -> str:
    return (f"Z__C_RJTD_{init:%Y%m%d%H}0000_GSM_GPV_Rgl_"
            f"FD{ft_to_ddhh(ft):04d}_grib2.bin")


def parse_init(text: str) -> datetime:
    """YYYYMMDDHH（UTC）→ datetime"""
    return datetime.strptime(text, "%Y%m%d%H").replace(tzinfo=timezone.utc)


def list_remote(day: datetime) -> dict:
    """指定日(UTC)のRISHディレクトリを調べ、{初期時刻(YYYYMMDDHH): [FT,...]} を返す。"""
    url = f"{BASE_URL}/{day:%Y/%m/%d}/"
    try:
        r = requests.get(url, headers=HEADERS, timeout=30)
        if r.status_code != 200:
            return {}
    except requests.RequestException as e:
        print(f"  RISHへの接続に失敗: {e}")
        return {}
    found = {}
    for init, ddhh in set(re.findall(
            r"Z__C_RJTD_(\d{10})0000_GSM_GPV_Rgl_FD(\d{4})_grib2\.bin", r.text)):
        found.setdefault(init, []).append(ddhh_to_ft(int(ddhh)))
    return {k: sorted(v) for k, v in found.items()}


def find_latest_init(min_fts: int = 5, days_back: int = 3):
    """RISH 上で FT が min_fts 個以上揃っている最新の初期時刻を返す。(datetime, FTリスト)"""
    today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    for d in range(days_back + 1):
        found = list_remote(today - timedelta(days=d))
        for init in sorted(found, reverse=True):
            if len(found[init]) >= min_fts:
                return parse_init(init), found[init]
    return None, []


def download(init: datetime, ft: int, data_dir: Path = DEFAULT_DATA_DIR) -> Path | None:
    """1ファイルをダウンロード。既存ならスキップ。失敗時は None。"""
    fn = gsm_filename(init, ft)
    dest = Path(data_dir) / fn
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    url = f"{BASE_URL}/{init:%Y/%m/%d}/{fn}"
    tmp = dest.with_suffix(".part")
    try:
        with requests.get(url, headers=HEADERS, stream=True, timeout=120) as r:
            r.raise_for_status()
            with open(tmp, "wb") as f:
                for chunk in r.iter_content(chunk_size=1 << 16):
                    f.write(chunk)
        tmp.rename(dest)  # 途中失敗で壊れたファイルを残さない
        return dest
    except requests.RequestException as e:
        print(f"  ダウンロード失敗 FT={ft}h: {e}")
        tmp.unlink(missing_ok=True)
        return None


# 読み込む物理量: キー → (shortName, typeOfLevel, level)
SURFACE = {
    "msl": ("prmsl", "meanSea", 0),
    "sp": ("sp", "surface", 0),
    "u10": ("10u", "heightAboveGround", 10),
    "v10": ("10v", "heightAboveGround", 10),
    "t2": ("2t", "heightAboveGround", 2),
}
PLEVELS = (925, 850, 700, 500, 300)
PVARS = {"gh": "gh", "t": "t", "u": "u", "v": "v", "r": "r", "w": "w"}


def load_fields(path: Path) -> dict:
    """GRIB2 から描画に必要な全球2次元場を1回の走査で読む。

    返り値: {"lats","lons", "msl"(hPa), "sp"(hPa), "u10","v10","t2"(℃), "tp"(累積降水 mm, 無ければ None),
             "p": {925: {"gh"(m),"t"(℃),"u","v","r"(%),"w"(hPa/h)}, ...}}
    緯度は昇順（南→北）に並べ替える。
    """
    import numpy as np
    import pygrib

    want = {}
    for k, (sn, tl, lv) in SURFACE.items():
        want[(sn, tl, lv)] = ("s", k)
    for lv in PLEVELS:
        for k, sn in PVARS.items():
            want[(sn, "isobaricInhPa", lv)] = ("p", (lv, k))

    out = {"p": {lv: {} for lv in PLEVELS}, "tp": None}
    lats = lons = None
    grbs = pygrib.open(str(path))
    try:
        for m in grbs:
            key = (m.shortName, m.typeOfLevel, m.level)
            if key in want:
                kind, k = want[key]
                vals = np.asarray(m.values, dtype=np.float32)
                if lats is None:
                    la, lo = m.latlons()
                    lats, lons = la[:, 0], lo[0, :]
                if kind == "s":
                    out[k] = vals
                else:
                    out["p"][k[0]][k[1]] = vals
            elif (m.typeOfLevel == "surface" and m.shortName == "unknown"
                  and m.parameterCategory == 1 and m.parameterNumber == 8):
                # 積算降水量 APCP（初期時刻からの積算 mm）。pygrib の表に無く name が unknown になる
                out["tp"] = np.asarray(m.values, dtype=np.float32)
    finally:
        grbs.close()

    # 単位変換
    out["msl"] = out["msl"] / 100.0           # Pa → hPa
    out["sp"] = out["sp"] / 100.0             # 地表気圧 Pa → hPa（地面下のマスクに使う）
    out["t2"] = out["t2"] - 273.15            # K → ℃
    for lv in PLEVELS:
        d = out["p"][lv]
        d["t"] = d["t"] - 273.15
        d["w"] = d["w"] * 36.0                # Pa/s → hPa/h（上昇が負）
    # 緯度を昇順へ
    if lats[0] > lats[-1]:
        lats = lats[::-1]
        for k in ("msl", "sp", "u10", "v10", "t2", "tp"):
            if out.get(k) is not None:
                out[k] = out[k][::-1, :]
        for lv in PLEVELS:
            for k in out["p"][lv]:
                out["p"][lv][k] = out["p"][lv][k][::-1, :]
    out["lats"], out["lons"] = lats, lons
    return out
