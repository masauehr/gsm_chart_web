// GSM天気図ボード（画用紙版）: 複数の図を並べ、マウスで移動・拡大縮小し、キーで時間を前後させる
// 画像規則は通常版と同じ: /output/{init}/{region}/{chart}_{ft:03d}.png、一覧は /output/manifest.json
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const IMG_W = 950, IMG_H = 760, TITLE_H = 22;           // 元画像のサイズと見出し帯の高さ
  const MIN_W = IMG_W * 0.25, MAX_W = IMG_W * 2;          // 0.25〜2倍（元アプリと同じ）
  // 並び順（地上→低層→高層）。未知の図は末尾
  const ORDER = ["surf", "tenki", "t975", "t925", "t850", "ept850", "t700", "t500", "z500", "jet300"];
  // 上部バーのボタン用の短い名前（重複しないように）
  const SHORT = { surf: "地上降水", tenki: "天気", t975: "975", t925: "925", t850: "850", ept850: "850EPT",
                  t700: "700", t500: "500気温", z500: "500高度", jet300: "300" };
  const REGION_DEFAULT = "japan";
  const DEFAULT_ON = ["surf", "t925", "t850", "t700", "z500", "jet300"];
  const LS_KEY = "gsmBoard.v1";
  const pad = (n) => String(n).padStart(2, "0");

  const S = { m: null, init: null, region: null, ft: 0, panels: {}, zTop: 1, active: null, timer: null };
  const els = {}; // chart → {root, img, nodata, title}

  const imgUrl = (init, region, chart, ft) => `/output/${init}/${region}/${chart}_${String(ft).padStart(3, "0")}.png`;
  const parseInit = (s) => new Date(Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(8, 10)));
  const fmt = (d, off, tz) => {
    const t = new Date(d.getTime() + off * 3600e3);
    return `${t.getUTCMonth() + 1}/${pad(t.getUTCDate())}(${"日月火水木金土"[t.getUTCDay()]}) ${pad(t.getUTCHours())}時${tz}`;
  };
  const cur = () => S.m.inits.find((i) => i.init === S.init);
  const charts = () => Object.keys((cur().regions[S.region]) || {})
    .sort((a, b) => (ORDER.indexOf(a) + 99) % 99 - (ORDER.indexOf(b) + 99) % 99);

  // 現在の初期値・地域で選べるFT（表示中の図の和集合）
  function fts() {
    const reg = cur().regions[S.region] || {};
    const set = new Set();
    for (const c of Object.keys(S.panels)) if (S.panels[c].on && reg[c]) reg[c].forEach((f) => set.add(f));
    if (!set.size) Object.values(reg).forEach((a) => a.forEach((f) => set.add(f)));
    return [...set].sort((a, b) => a - b);
  }

  // ---------- 保存・復元
  const save = () => localStorage.setItem(LS_KEY, JSON.stringify({ panels: S.panels, region: S.region, init: S.init, ft: S.ft }));
  function load() { try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch (e) { return {}; } }

  // ---------- パネル
  function ensurePanel(chart) {
    if (els[chart]) return els[chart];
    const root = document.createElement("div");
    root.className = "panel";
    root.innerHTML =
      `<div class="title"><span></span><span class="x" title="閉じる">✕</span></div>` +
      `<div class="body"><img alt=""><div class="nodata" hidden>この時刻の画像なし</div><div class="grip" title="ドラッグで大きさ変更"></div></div>`;
    $("board").appendChild(root);
    const e = { root, img: root.querySelector("img"), nodata: root.querySelector(".nodata"),
                title: root.querySelector(".title span"), wantUrl: "" };
    e.title.textContent = S.m.charts[chart] || chart;
    els[chart] = e;
    wirePanel(chart, e);
    return e;
  }

  function applyGeom(chart) {
    const p = S.panels[chart], e = els[chart];
    if (!e) return;
    e.root.style.display = p.on ? "" : "none";
    e.root.style.left = p.x + "px";
    e.root.style.top = p.y + "px";
    e.root.style.width = p.w + "px";
    e.root.style.zIndex = p.z;
  }

  function activate(chart) {
    S.active = chart;
    for (const c in els) els[c].root.classList.toggle("active", c === chart);
    S.panels[chart].z = ++S.zTop;
    applyGeom(chart);
  }

  function wirePanel(chart, e) {
    const p = () => S.panels[chart];
    // 移動（タイトル帯をドラッグ）
    e.root.querySelector(".title").addEventListener("pointerdown", (ev) => {
      if (ev.target.classList.contains("x")) return;
      activate(chart);
      const sx = ev.clientX, sy = ev.clientY, ox = p().x, oy = p().y;
      const mv = (m) => { p().x = Math.max(0, ox + m.clientX - sx); p().y = Math.max(0, oy + m.clientY - sy); applyGeom(chart); };
      const up = () => { removeEventListener("pointermove", mv); removeEventListener("pointerup", up); save(); };
      addEventListener("pointermove", mv); addEventListener("pointerup", up);
      ev.preventDefault();
    });
    // 大きさ変更（右下をドラッグ。縦横比は元画像のまま）
    e.root.querySelector(".grip").addEventListener("pointerdown", (ev) => {
      activate(chart);
      const sx = ev.clientX, sy = ev.clientY, ow = p().w;
      const mv = (m) => {
        // 横・縦どちらの移動量も使い、大きい方に追従
        const dw = Math.max(m.clientX - sx, (m.clientY - sy) * IMG_W / IMG_H);
        p().w = Math.min(MAX_W, Math.max(MIN_W, ow + dw));
        applyGeom(chart);
      };
      const up = () => { removeEventListener("pointermove", mv); removeEventListener("pointerup", up); save(); };
      addEventListener("pointermove", mv); addEventListener("pointerup", up);
      ev.preventDefault(); ev.stopPropagation();
    });
    // クリックで前面・ホイールで拡大縮小（カーソル位置を基準にする）
    e.root.addEventListener("pointerdown", () => activate(chart));
    e.root.addEventListener("wheel", (ev) => {
      ev.preventDefault();
      const r = e.root.getBoundingClientRect();
      const k = ev.deltaY < 0 ? 1.1 : 1 / 1.1;
      const nw = Math.min(MAX_W, Math.max(MIN_W, p().w * k));
      const f = nw / p().w;
      p().x = Math.max(0, p().x + (ev.clientX - r.left) * (1 - f)); // タイトル帯が画面外に出ないよう0以上
      p().y = Math.max(0, p().y + (ev.clientY - r.top) * (1 - f));
      p().w = nw;
      applyGeom(chart); save();
    }, { passive: false });
    e.root.querySelector(".x").onclick = () => { p().on = false; applyGeom(chart); buildToggles(); save(); };
  }

  // 画像の差し替え（読み込み完了まで古い画像を残してちらつきを防ぐ）
  function setImage(chart) {
    const e = ensurePanel(chart);
    const reg = cur().regions[S.region] || {};
    const has = reg[chart] && reg[chart].includes(S.ft);
    e.nodata.hidden = !!has;
    if (!has) return;
    const url = imgUrl(S.init, S.region, chart, S.ft);
    e.wantUrl = url;
    const im = new Image();
    im.onload = () => { if (e.wantUrl === url) e.img.src = url; };
    im.src = url;
  }

  function refresh() {
    for (const c of charts()) {
      if (!S.panels[c]) continue;
      ensurePanel(c);
      applyGeom(c);
      if (S.panels[c].on) setImage(c);
    }
    for (const c in els) if (!charts().includes(c)) els[c].root.style.display = "none";
    const d = parseInit(S.init);
    $("dateLabel").textContent = `${fmt(d, S.ft, "UTC")} (${fmt(d, S.ft + 9, "JST")}) ｜ 初期値 ${pad(d.getUTCHours())}UTC ＋${S.ft}h`;
    prefetch();
    save();
  }

  // 前後のFTを先読み（↑↓での閲覧を軽くする）
  function prefetch() {
    const f = fts(), i = f.indexOf(S.ft);
    for (const ft of [f[i + 1], f[i - 1]]) {
      if (ft === undefined) continue;
      for (const c in S.panels) if (S.panels[c].on) new Image().src = imgUrl(S.init, S.region, c, ft);
    }
  }

  // ---------- 配置
  function tile() {
    const on = charts().filter((c) => S.panels[c].on);
    if (!on.length) return;
    const W = innerWidth, H = innerHeight - (document.body.classList.contains("nobar") ? 0 : 40);
    let best = null;
    for (let cols = 1; cols <= on.length; cols++) {
      const rows = Math.ceil(on.length / cols);
      const w = Math.min(W / cols, ((H / rows) - TITLE_H) * IMG_W / IMG_H) - 4;
      if (!best || w > best.w) best = { cols, w };
    }
    const w = Math.min(MAX_W, Math.max(MIN_W, Math.floor(best.w)));
    on.forEach((c, i) => {
      S.panels[c].w = w;
      S.panels[c].x = (i % best.cols) * (w + 4) + 2;
      S.panels[c].y = Math.floor(i / best.cols) * (w * IMG_H / IMG_W + TITLE_H + 4) + 2;
      S.panels[c].z = ++S.zTop;
      applyGeom(c);
    });
    save();
  }

  function resetLayout() {
    for (const c of charts()) S.panels[c] = { on: DEFAULT_ON.includes(c), x: 0, y: 0, w: 450, z: 1 };
    buildToggles(); refresh(); tile();
  }

  // ---------- UI
  function buildToggles() {
    const box = $("chartToggles");
    box.innerHTML = "";
    for (const c of charts()) {
      const b = document.createElement("button");
      b.textContent = SHORT[c] || (S.m.charts[c] || c);
      b.title = S.m.charts[c] || c;
      b.className = S.panels[c] && S.panels[c].on ? "on" : "";
      b.onclick = () => {
        const p = S.panels[c];
        p.on = !p.on;
        if (p.on) { ensurePanel(c); setImage(c); activate(c); }
        applyGeom(c); buildToggles(); save();
      };
      box.appendChild(b);
    }
  }

  function buildSelects() {
    const si = $("initSel");
    si.innerHTML = "";
    for (const i of S.m.inits) {
      const o = document.createElement("option");
      o.value = i.init; o.textContent = fmt(parseInit(i.init), 0, "UTC") + " 初期値";
      si.appendChild(o);
    }
    si.value = S.init;
    si.onchange = () => { S.init = si.value; fixFt(); refresh(); };
    const sr = $("regionSel");
    sr.innerHTML = "";
    for (const r of Object.keys(cur().regions)) {
      const o = document.createElement("option");
      o.value = r; o.textContent = S.m.regions[r] || r;
      sr.appendChild(o);
    }
    sr.value = S.region;
    sr.onchange = () => { S.region = sr.value; fixFt(); refresh(); };
  }

  function fixFt() {
    const f = fts();
    if (f.length && !f.includes(S.ft)) S.ft = f.reduce((a, b) => (Math.abs(b - S.ft) < Math.abs(a - S.ft) ? b : a));
  }

  // ---------- 時間操作
  function stepFt(d) { // d=+1: 予報時間を進める（端で止まる）
    const f = fts(), i = f.indexOf(S.ft) + d;
    if (i >= 0 && i < f.length) { S.ft = f[i]; refresh(); }
  }
  function setFt(ft) { S.ft = ft; fixFt(); refresh(); }
  // 初期時刻を前後へ。keepValid=true なら予報有効時刻を固定（FTを逆方向に補正）
  function stepInit(d, keepValid) {
    const list = S.m.inits.map((i) => i.init).sort(); // 昇順（古→新）
    const j = list.indexOf(S.init) + d;
    if (j < 0 || j >= list.length) return;
    const dh = (parseInit(list[j]) - parseInit(S.init)) / 3600e3;
    S.init = list[j];
    if (keepValid) S.ft = Math.max(0, S.ft - dh);
    $("initSel").value = S.init;
    fixFt(); refresh();
  }
  function play() {
    if (S.timer) { stop(); return; }
    $("btnPlay").textContent = "⏸";
    S.timer = setInterval(() => {
      const f = fts(), i = f.indexOf(S.ft);
      S.ft = f[(i + 1) % f.length]; refresh();
    }, 700);
  }
  function stop() { if (S.timer) { clearInterval(S.timer); S.timer = null; } $("btnPlay").textContent = "▶"; }

  addEventListener("keydown", (e) => {
    if (e.target.tagName === "SELECT" || e.target.tagName === "INPUT") return;
    const k = e.key;
    if (k === "ArrowUp") { e.ctrlKey ? setFt(Math.max(...fts())) : stepFt(+1); }
    else if (k === "ArrowDown") { e.ctrlKey ? setFt(Math.min(...fts())) : stepFt(-1); }
    else if (k === "ArrowRight") stepInit(+1, e.ctrlKey);
    else if (k === "ArrowLeft") stepInit(-1, e.ctrlKey);
    else if (k === "p" || k === "P") play();
    else if (k === "s" || k === "S") stop();
    else if (k === "t" || k === "T") tile();
    else if (k === "i" || k === "I") resetLayout();
    else if (k === "d" || k === "D") { $("bar").classList.toggle("hide"); document.body.classList.toggle("nobar"); }
    else if (k === "h" || k === "H") $("help").hidden = !$("help").hidden;
    else if (k === "b" || k === "B") { if (S.active) { S.panels[S.active].z = 0; applyGeom(S.active); } }
    else return;
    e.preventDefault();
    if (k.startsWith("Arrow")) stop(); // 矢印キーで再生停止（元アプリと同様）
  });

  $("btnTile").onclick = tile;
  $("btnPlay").onclick = play;
  $("btnReset").onclick = resetLayout;
  $("btnHelp").onclick = () => { $("help").hidden = !$("help").hidden; };
  $("btnHelpClose").onclick = () => { $("help").hidden = true; };

  // ---------- 起動
  async function boot() {
    try { S.m = await (await fetch("/output/manifest.json", { cache: "no-store" })).json(); }
    catch (e) { $("dateLabel").textContent = "manifest.json を読めません（make_charts.py を先に実行）"; return; }
    if (!S.m.inits.length) { $("dateLabel").textContent = "天気図がありません（make_charts.py を実行）"; return; }
    const sv = load();
    S.init = S.m.inits.some((i) => i.init === sv.init) ? sv.init : S.m.inits[0].init;
    const regs = Object.keys(cur().regions);
    S.region = regs.includes(sv.region) ? sv.region : (regs.includes(REGION_DEFAULT) ? REGION_DEFAULT : regs[0]);
    S.ft = sv.ft || 0;
    const all = new Set(S.m.inits.flatMap((i) => Object.values(i.regions).flatMap((r) => Object.keys(r))));
    let fresh = !sv.panels;
    for (const c of all) S.panels[c] = (sv.panels && sv.panels[c]) || { on: false, x: 0, y: 0, w: 450, z: 1 };
    if (fresh) for (const c of DEFAULT_ON) if (S.panels[c]) S.panels[c].on = true;
    S.zTop = Math.max(1, ...Object.values(S.panels).map((p) => p.z || 1));
    fixFt();
    buildSelects(); buildToggles();
    refresh();
    if (fresh) tile();
  }
  // ---------- 最新データの取得（サーバーの /api/update を呼ぶ）
  async function reloadManifest() {
    if (!S.m) { location.reload(); return; }
    const m = await (await fetch("/output/manifest.json", { cache: "no-store" })).json();
    if (!m.inits.length) return;
    const newest = m.inits[0].init;
    const isNew = !S.m.inits.some((i) => i.init === newest);
    S.m = m;
    if (isNew || !m.inits.some((i) => i.init === S.init)) S.init = newest; // 新しい初期値が増えたら切り替える
    if (!cur().regions[S.region]) S.region = Object.keys(cur().regions)[0];
    for (const c of Object.keys(cur().regions[S.region])) {          // 新しい図種があればパネル定義を追加
      if (!S.panels[c]) S.panels[c] = { on: false, x: 0, y: 0, w: 450, z: 1 };
    }
    fixFt(); buildSelects(); buildToggles(); refresh();
  }

  async function pollUpdate() {
    let j;
    try { j = await (await fetch("/api/status")).json(); } catch (e) { $("updateMsg").textContent = "状態を取得できません"; return; }
    const last = (j.log && j.log.length) ? j.log[j.log.length - 1] : "";
    if (j.running) {
      $("btnUpdate").disabled = true;
      $("updateMsg").textContent = "更新中… " + last;
      setTimeout(pollUpdate, 3000);
    } else {
      $("btnUpdate").disabled = false;
      if (j.rc === null || j.rc === undefined) { $("updateMsg").textContent = ""; return; }
      $("updateMsg").textContent = j.rc === 0 ? "更新完了" : "更新に失敗（logs/update_ui.log）";
      if (j.rc === 0) reloadManifest();
    }
  }

  $("btnUpdate").onclick = async () => {
    $("btnUpdate").disabled = true;
    $("updateMsg").textContent = "更新を開始しています…";
    try { await fetch("/api/update", { method: "POST" }); } catch (e) { $("updateMsg").textContent = "開始できません"; $("btnUpdate").disabled = false; return; }
    pollUpdate();
  };

  boot().then(pollUpdate);
})();
