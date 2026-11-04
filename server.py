#!/usr/bin/env python
# coding: utf-8
"""天気図ビューア用の簡易サーバー（標準ライブラリのみ）。

  /          → web/ の静的ファイル
  /output/   → output/（make_charts.py が作成したPNGとmanifest.json）

使用例:
  python server.py                 # http://127.0.0.1:8780/
  python server.py --port 9000
外部公開はしない設計（127.0.0.1 固定）。LAN内の別端末から見る場合のみ --host 0.0.0.0 を明示する。
"""
import argparse
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent


class Handler(SimpleHTTPRequestHandler):
    """/output/ を output/ ディレクトリへ振り分け、manifest.json はキャッシュさせない。"""

    def translate_path(self, path):
        p = path.split("?", 1)[0].split("#", 1)[0]
        if p.startswith("/output/"):
            rel = Path(p[len("/output/"):])
            target = (ROOT / "output" / rel).resolve()
            # ディレクトリトラバーサル対策: output/ の外へ出さない
            if (ROOT / "output").resolve() not in target.parents and target != (ROOT / "output").resolve():
                return str(ROOT / "output" / "__forbidden__")
            return str(target)
        return super().translate_path(path)

    def end_headers(self):
        if self.path.split("?", 1)[0].endswith((".json", ".html", ".js", ".css", "/")):
            self.send_header("Cache-Control", "no-cache")
        else:
            self.send_header("Cache-Control", "max-age=600")  # PNGは初期値ごとに別ファイル名のため短期キャッシュ可
        super().end_headers()

    def log_message(self, fmt, *args):
        pass  # アクセスログは出さない


def main():
    p = argparse.ArgumentParser(description="GSM天気図ビューアのサーバー")
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=8780)
    if any(a in sys.argv[1:] for a in ("?", "-?", "--?")):
        p.print_help()
        return
    a = p.parse_args()
    handler = partial(Handler, directory=str(ROOT / "web"))
    srv = ThreadingHTTPServer((a.host, a.port), handler)
    print(f"http://{a.host}:{a.port}/ で公開中（Ctrl+C で停止）")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
