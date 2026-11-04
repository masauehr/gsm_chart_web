// GSM天気図ビューア（Vanilla JS）
// 画像規則: /output/{init}/{region}/{chart}_{ft:03d}.png、一覧は /output/manifest.json
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const S = { manifest: null, init: null, region: null, chart: null, ft: 0, timer: null };
  const cache = new Map(); // 先読み画像（再生を滑らかにする）

  const imgUrl = (init, region, chart, ft) =>
    `/output/${init}/${region}/${chart}_${String(ft).padStart(3, "0")}.png`;

  const pad = (n) => String(n).padStart(2, "0");

  // "2026110318" → Date(UTC)
  function parseInit(s) {
    return new Date(Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(8, 10)));
  }
  function fmt(d, offsetH, tz) {
    const t = new Date(d.getTime() + offsetH * 3600e3);
    const w = "日月火水木金土"[t.getUTCDay()];
    return `${t.getUTCMonth() + 1}/${t.getUTCDate()}(${w}) ${pad(t.getUTCHours())}時${tz}`;
  }

  const cur = () => S.manifest.inits.find((i) => i.init === S.init);
  const fts = () => {
    const r = cur() && cur().regions[S.region];
    return (r && r[S.chart]) || [];
  };

  // ---------- URLハッシュ（リロード・共有で状態を保つ）
  function saveHash() {
    history.replaceState(null, "", `#init=${S.init}&region=${S.region}&chart=${S.chart}&ft=${S.ft}`);
  }
  function loadHash() {
    const h = Object.fromEntries(new URLSearchParams(location.hash.slice(1)));
    return h;
  }

  // ---------- 初期化
  async function boot() {
    let m;
    try {
      const r = await fetch("/output/manifest.json", { cache: "no-store" });
      m = await r.json();
    } catch (e) {
      $("viewer").innerHTML = '<div style="padding:40px">manifest.json を読めません。先に <code>python make_charts.py --latest</code> を実行してください。</div>';
      return;
    }
    S.manifest = m;
    if (!m.inits.length) {
      $("viewer").innerHTML = '<div style="padding:40px">天気図がまだありません。<code>python make_charts.py --latest</code> を実行してください。</div>';
      return;
    }
    $("updated").textContent = "マニフェスト更新: " + new Date(m.updated).toLocaleString("ja-JP");

    const h = loadHash();
    S.init = m.inits.some((i) => i.init === h.init) ? h.init : m.inits[0].init;
    const regs = Object.keys(cur().regions);
    S.region = regs.includes(h.region) ? h.region : regs[0];
    const charts = Object.keys(cur().regions[S.region]);
    S.chart = charts.includes(h.chart) ? h.chart : charts[0];
    S.ft = +h.ft || 0;

    buildInitSel();
    buildRegionBtns();
    buildTabs();
    update();
  }

  function buildInitSel() {
    const sel = $("initSel");
    sel.innerHTML = "";
    for (const i of S.manifest.inits) {
      const o = document.createElement("option");
      const d = parseInit(i.init);
      o.value = i.init;
      o.textContent = `${fmt(d, 0, "UTC")} 初期値`;
      sel.appendChild(o);
    }
    sel.value = S.init;
    sel.onchange = () => { S.init = sel.value; keepValid(); buildRegionBtns(); buildTabs(); update(); };
  }

  function buildRegionBtns() {
    const box = $("regionBtns");
    box.innerHTML = "";
    for (const r of Object.keys(cur().regions)) {
      const b = document.createElement("button");
      b.textContent = S.manifest.regions[r] || r;
      b.className = r === S.region ? "on" : "";
      b.onclick = () => { S.region = r; keepValid(); buildRegionBtns(); buildTabs(); update(); };
      box.appendChild(b);
    }
  }

  function buildTabs() {
    const box = $("chartTabs");
    box.innerHTML = "";
    for (const c of Object.keys(cur().regions[S.region])) {
      const b = document.createElement("button");
      b.textContent = S.manifest.charts[c] || c;
      b.className = c === S.chart ? "on" : "";
      b.onclick = () => { S.chart = c; update(); buildTabs(); };
      box.appendChild(b);
    }
  }

  // 初期値・地域を切り替えたあと、図種とFTが存在しなければ近いものへ寄せる
  function keepValid() {
    const regs = cur().regions;
    if (!regs[S.region]) S.region = Object.keys(regs)[0];
    const charts = Object.keys(regs[S.region]);
    if (!charts.includes(S.chart)) S.chart = charts[0];
    const f = fts();
    if (f.length && !f.includes(S.ft)) S.ft = f.reduce((a, b) => (Math.abs(b - S.ft) < Math.abs(a - S.ft) ? b : a));
  }

  // ---------- 表示更新
  function update() {
    const f = fts();
    const slider = $("ftSlider");
    slider.max = Math.max(f.length - 1, 0);
    if (!f.includes(S.ft)) S.ft = f[0] ?? 0;
    slider.value = Math.max(f.indexOf(S.ft), 0);

    const img = $("chartImg");
    const url = imgUrl(S.init, S.region, S.chart, S.ft);
    $("noData").hidden = f.length > 0;
    if (f.length) img.src = url;
    $("dlLink").href = url;
    $("dlLink").download = `gsm_${S.init}_${S.region}_${S.chart}_FT${S.ft}.png`;

    const d = parseInit(S.init);
    $("timeInfo").innerHTML =
      `初期値 ${fmt(d, 0, "UTC")} ／ <b>FT=${S.ft}h</b> ／ 予報時刻 <b>${fmt(d, S.ft, "UTC")}</b>（${fmt(d, S.ft + 9, "JST")}）`;

    buildThumbs();
    preload();
    saveHash();
  }

  function buildThumbs() {
    const box = $("thumbs");
    box.innerHTML = "";
    const regs = cur().regions[S.region];
    for (const c of Object.keys(regs)) {
      if (!regs[c].includes(S.ft)) continue;
      const fig = document.createElement("figure");
      fig.className = c === S.chart ? "on" : "";
      fig.innerHTML = `<img loading="lazy" src="${imgUrl(S.init, S.region, c, S.ft)}" alt=""><figcaption>${S.manifest.charts[c] || c}</figcaption>`;
      fig.onclick = () => { S.chart = c; update(); buildTabs(); };
      box.appendChild(fig);
    }
  }

  // 同じ図種の全FTを先読み（アニメーション用）
  function preload() {
    for (const ft of fts()) {
      const u = imgUrl(S.init, S.region, S.chart, ft);
      if (!cache.has(u)) { const i = new Image(); i.src = u; cache.set(u, i); }
    }
  }

  // ---------- 操作
  function step(d) {
    const f = fts();
    if (!f.length) return;
    let i = f.indexOf(S.ft) + d;
    i = (i + f.length) % f.length; // 端で循環
    S.ft = f[i];
    update();
  }
  function setIndex(i) { const f = fts(); if (f.length) { S.ft = f[Math.min(Math.max(i, 0), f.length - 1)]; update(); } }
  function play() {
    if (S.timer) { clearInterval(S.timer); S.timer = null; $("btnPlay").textContent = "▶"; return; }
    $("btnPlay").textContent = "⏸";
    S.timer = setInterval(() => step(1), +$("speedSel").value);
  }

  $("btnPrev").onclick = () => step(-1);
  $("btnNext").onclick = () => step(1);
  $("btnFirst").onclick = () => setIndex(0);
  $("btnLast").onclick = () => setIndex(fts().length - 1);
  $("btnPlay").onclick = play;
  $("ftSlider").oninput = (e) => setIndex(+e.target.value);
  $("speedSel").onchange = () => { if (S.timer) { play(); play(); } };

  window.addEventListener("keydown", (e) => {
    if (e.target.tagName === "SELECT" || e.target.tagName === "INPUT") return;
    const charts = Object.keys(cur().regions[S.region]);
    const ci = charts.indexOf(S.chart);
    if (e.key === "ArrowLeft") step(-1);
    else if (e.key === "ArrowRight") step(1);
    else if (e.key === "ArrowUp") { S.chart = charts[(ci - 1 + charts.length) % charts.length]; update(); buildTabs(); }
    else if (e.key === "ArrowDown") { S.chart = charts[(ci + 1) % charts.length]; update(); buildTabs(); }
    else if (e.key === " ") play();
    else if (e.key === "Home") setIndex(0);
    else if (e.key === "End") setIndex(fts().length - 1);
    else return;
    e.preventDefault();
  });

  boot();
})();
