(() => {
  const C = window.VICE_CONFIG || {};
  const Core = window.ViceCore;
  const $ = (id) => document.getElementById(id);
  const fmt = (n) => Number(n).toLocaleString("es-ES");
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  };

  // ---------- Config into the page ----------
  if (C.ticker) $("ticker").textContent = C.ticker;
  if (C.prize) $("prize").textContent = C.prize;
  if (C.ca) $("ca").textContent = C.ca;
  if (C.xUrl) $("x-link").href = C.xUrl;
  if (C.buyUrl) { $("buy-link").href = C.buyUrl; $("buy-link").hidden = false; }
  $("btn-copy").hidden = !C.ca;
  $("btn-copy").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(C.ca); $("btn-copy").textContent = "Copiado"; setTimeout(() => ($("btn-copy").textContent = "Copiar"), 1500); }
    catch { const r = document.createRange(); r.selectNodeContents($("ca")); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
  });

  // ---------- Countdown ----------
  const target = new Date(C.launch || "2026-11-18T23:00:00Z").getTime();
  const pad2 = (n) => String(n).padStart(2, "0");
  (function tick() {
    let t = target - Date.now();
    if (t <= 0) { $("digits").innerHTML = '<span class="released">¡Ya está aquí!</span>'; return; }
    const d = Math.floor(t / 864e5); t -= d * 864e5;
    const h = Math.floor(t / 36e5); t -= h * 36e5;
    const m = Math.floor(t / 6e4); t -= m * 6e4;
    $("cd-d").textContent = pad2(d); $("cd-h").textContent = pad2(h);
    $("cd-m").textContent = pad2(m); $("cd-s").textContent = pad2(Math.floor(t / 1000));
    setTimeout(tick, 1000 - (Date.now() % 1000) + 5);
  })();

  // ---------- Canvas ----------
  const cv = $("cv"), ctx = cv.getContext("2d");
  const { W, H, GROUND } = Core;
  function fit() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = W * dpr; cv.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    draw();
  }

  // ---------- Game state ----------
  const TICK = 1000 / Core.TICKS_PER_SEC;
  let S = Core.create(1);
  let state = "idle";            // idle | starting | run | pause | over
  let run = { token: null, inputs: [] };
  let queue = [];
  let acc = 0, last = performance.now();
  let parts = [], flash = 0, shake = 0;

  const rnd = (a, b) => a + Math.random() * (b - a);
  const bldgs = Array.from({ length: 22 }, (_, i) => ({ x: i * 64, w: rnd(38, 60), h: rnd(60, 160), lit: Math.floor(rnd(0, 97)) }));
  const palms = Array.from({ length: 7 }, (_, i) => ({ x: i * 170 + rnd(0, 60), h: rnd(84, 120) }));

  async function start() {
    if (state === "starting" || state === "run") return;
    state = "starting";
    hideOverlays();
    let token = null, seed = (Math.random() * 4294967296) >>> 0;
    try {
      const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 4000);
      const r = await fetch("/api/start", { method: "POST", signal: ctl.signal });
      clearTimeout(to);
      if (r.ok) { const j = await r.json(); token = j.token; seed = j.seed >>> 0; }
    } catch {}
    run = { token, inputs: [] };
    S = Core.create(seed);
    queue = []; parts = []; acc = 0; last = performance.now();
    state = "run";
    cv.focus({ preventScroll: true });
  }

  function pause(on) {
    if (on && state === "run") { state = "pause"; $("ov-pause").hidden = false; }
    else if (!on && state === "pause") { state = "run"; $("ov-pause").hidden = true; last = performance.now(); acc = 0; cv.focus({ preventScroll: true }); }
  }

  function hideOverlays() { $("ov-start").hidden = true; $("ov-over").hidden = true; $("ov-pause").hidden = true; }

  function gameOver() {
    state = "over";
    shake = 14;
    const sc = Core.score(S);
    $("final").textContent = fmt(sc);
    const best = Number(store.get("vr-best")) || 0;
    if (sc > best) store.set("vr-best", String(sc));
    $("final-sub").textContent = (sc > best && best > 0 ? "¡Nuevo récord personal! " : "") +
      `${fmt(S.kills)} polis abatidos · mejor marca: ${fmt(Math.max(best, sc))}`;
    $("save-msg").textContent = ""; $("save-msg").className = "msg";
    $("btn-save").disabled = !run.token;
    $("save-form").hidden = !run.token || sc === 0;
    if (!run.token) { $("save-msg").textContent = "Sin conexión con el servidor: esta partida no se puede guardar."; $("save-msg").className = "msg err"; }
    $("handle").value = store.get("vr-handle") || "";
    setTimeout(() => { $("ov-over").hidden = false; cv.blur(); }, 650);
  }

  // ---------- Input ----------
  function act(a) { if (state === "run") queue.push(a); }
  window.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT") return;
    const k = e.code;
    if (k === "Space" || k === "ArrowUp" || k === "KeyW") {
      e.preventDefault();
      if (state === "run") act("j");
      else if (state === "idle") start();
    } else if (k === "KeyF" || k === "KeyJ" || k === "ArrowRight") {
      if (state === "run") { e.preventDefault(); act("s"); }
    } else if (k === "KeyP" || k === "Escape") {
      if (state === "run") pause(true); else if (state === "pause") pause(false);
    } else if (k === "Enter") {
      if (state === "idle" || state === "over") { e.preventDefault(); start(); }
      else if (state === "pause") { e.preventDefault(); pause(false); }
    }
  });
  cv.addEventListener("mousedown", (e) => { if (state === "run") { e.preventDefault(); act("s"); } else if (state === "idle") start(); });
  cv.addEventListener("contextmenu", (e) => { if (state === "run") e.preventDefault(); });
  $("b-jump").addEventListener("pointerdown", (e) => { e.preventDefault(); state === "run" ? act("j") : state === "idle" && start(); });
  $("b-shoot").addEventListener("pointerdown", (e) => { e.preventDefault(); act("s"); });
  $("btn-start").addEventListener("click", start);
  $("btn-again").addEventListener("click", start);
  $("btn-resume").addEventListener("click", () => pause(false));
  document.addEventListener("visibilitychange", () => { if (document.hidden) pause(true); });
  window.addEventListener("blur", () => pause(true));

  // ---------- Loop ----------
  function frame(t) {
    let dt = t - last; last = t;
    if (dt > 250) dt = 250;
    if (state === "run") {
      acc += dt;
      while (acc >= TICK && state === "run") {
        for (const a of queue) {
          const ok = a === "j" ? Core.jump(S) : Core.shoot(S);
          if (ok) run.inputs.push([S.tick, a]);
        }
        queue = [];
        Core.step(S);
        for (const ev of S.events) {
          if (ev.type === "kill") burst(ev.x, ev.y, "#2de2c9", 16);
          else if (ev.type === "dead") burst(ev.x, ev.y, "#ff4fa3", 26);
          else if (ev.type === "shot") flash = 4;
        }
        S.events.length = 0;
        acc -= TICK;
        if (S.over) gameOver();
      }
    }
    for (const p of parts) { p.x += p.vx; p.y += p.vy; p.vy += 0.3; p.life--; }
    parts = parts.filter((p) => p.life > 0);
    if (flash > 0) flash--;
    if (shake > 0) shake--;
    draw();
    requestAnimationFrame(frame);
  }
  function burst(x, y, color, n) {
    for (let i = 0; i < n; i++) parts.push({ x, y, vx: rnd(-4.5, 4.5), vy: rnd(-7, 1), life: rnd(22, 40), color });
  }

  // ---------- Drawing ----------
  function drawBg() {
    const d = S.dist;
    const g = ctx.createLinearGradient(0, 0, 0, GROUND);
    g.addColorStop(0, "#241341"); g.addColorStop(0.5, "#8f2f74"); g.addColorStop(1, "#ffb347");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, GROUND);
    // a few stars
    ctx.fillStyle = "rgba(255,241,230,.6)";
    for (let i = 0; i < 26; i++) ctx.fillRect((i * 137) % W, (i * 53) % 110, 2, 2);
    // striped sun
    ctx.save();
    ctx.beginPath(); ctx.arc(660, 218, 96, 0, Math.PI * 2); ctx.clip();
    const sg = ctx.createLinearGradient(0, 122, 0, 300);
    sg.addColorStop(0, "#ffe08a"); sg.addColorStop(1, "#ff4fa3");
    ctx.fillStyle = sg; ctx.fillRect(560, 120, 200, 200);
    ctx.fillStyle = "#8f2f74";
    for (let i = 0; i < 7; i++) ctx.fillRect(560, 222 + i * 12, 200, 2 + i);
    ctx.restore();
    // skyline
    const span1 = 22 * 64, o1 = (d * 0.15) % span1;
    for (const b of bldgs) {
      let x = b.x - o1; if (x < -70) x += span1;
      ctx.fillStyle = "#35195a"; ctx.fillRect(x, GROUND - b.h, b.w, b.h);
      ctx.fillStyle = "rgba(255,179,71,.55)";
      let n = b.lit;
      for (let wy = GROUND - b.h + 10; wy < GROUND - 16; wy += 16)
        for (let wx = x + 6; wx < x + b.w - 8; wx += 12) { n = (n * 31 + 7) % 97; if (n < 22) ctx.fillRect(wx, wy, 4, 6); }
    }
    // palms
    const span2 = 7 * 170, o2 = (d * 0.45) % span2;
    ctx.fillStyle = "#170c29"; ctx.strokeStyle = "#170c29"; ctx.lineWidth = 7;
    for (const p of palms) {
      let x = p.x - o2; if (x < -70) x += span2;
      ctx.beginPath(); ctx.moveTo(x, GROUND); ctx.quadraticCurveTo(x + 12, GROUND - p.h / 2, x + 4, GROUND - p.h); ctx.stroke();
      for (let a = 0; a < 5; a++) {
        const ang = -Math.PI / 2 + (a - 2) * 0.62;
        ctx.beginPath(); ctx.ellipse(x + 4 + Math.cos(ang) * 26, GROUND - p.h + Math.sin(ang) * 11 + 7, 30, 7, ang, 0, Math.PI * 2); ctx.fill();
      }
    }
    // road
    ctx.fillStyle = "#170c29"; ctx.fillRect(0, GROUND, W, H - GROUND);
    ctx.fillStyle = "#2de2c9"; ctx.fillRect(0, GROUND, W, 3);
    ctx.fillStyle = "#ffb347";
    const o3 = d % 90;
    for (let x = -o3; x < W; x += 90) ctx.fillRect(x, GROUND + 32, 46, 4);
  }

  // Vera: original protagonist — platinum bob, teal crop jacket, white shorts, pink sneakers
  function drawVera() {
    const p = S.p, x = p.x, y = p.y;
    const pose = !p.onGround ? 2 : Math.floor(S.tick / 5) % 2;
    const skin = "#d99a73";
    // legs
    ctx.fillStyle = skin;
    if (pose === 0) { ctx.fillRect(x + 6, y - 18, 6, 14); ctx.fillRect(x + 17, y - 16, 6, 11); }
    else if (pose === 1) { ctx.fillRect(x + 6, y - 16, 6, 11); ctx.fillRect(x + 17, y - 18, 6, 14); }
    else { ctx.fillRect(x + 3, y - 18, 6, 12); ctx.fillRect(x + 19, y - 20, 6, 11); }
    // sneakers
    ctx.fillStyle = "#ff4fa3";
    if (pose === 0) { ctx.fillRect(x + 5, y - 5, 9, 5); ctx.fillRect(x + 16, y - 6, 9, 5); }
    else if (pose === 1) { ctx.fillRect(x + 5, y - 6, 9, 5); ctx.fillRect(x + 16, y - 5, 9, 5); }
    else { ctx.fillRect(x + 2, y - 7, 9, 5); ctx.fillRect(x + 18, y - 9, 9, 5); }
    // shorts
    ctx.fillStyle = "#fff1e6"; ctx.fillRect(x + 4, y - 26, 21, 9);
    // midriff + jacket
    ctx.fillStyle = skin; ctx.fillRect(x + 6, y - 30, 17, 4);
    ctx.fillStyle = "#2de2c9"; ctx.fillRect(x + 3, y - 42, 23, 12);
    ctx.fillStyle = "#1fb6a2"; ctx.fillRect(x + 13, y - 42, 2, 12);
    // arm + pistol
    ctx.fillStyle = "#2de2c9"; ctx.fillRect(x + 20, y - 40, 8, 6);
    ctx.fillStyle = skin; ctx.fillRect(x + 27, y - 39, 6, 5);
    ctx.fillStyle = "#0d0d12"; ctx.fillRect(x + 31, y - 42, 11, 5); ctx.fillRect(x + 32, y - 38, 3, 4);
    if (flash > 0) { ctx.fillStyle = "#ffe08a"; ctx.fillRect(x + 42, y - 44, 8, 8); }
    // head
    ctx.fillStyle = skin; ctx.fillRect(x + 7, y - 54, 15, 12);
    ctx.fillStyle = "#0d0d12"; ctx.fillRect(x + 12, y - 50, 11, 3);       // sunglasses
    ctx.fillStyle = "#c23a5e"; ctx.fillRect(x + 18, y - 45, 3, 1);        // lips
    // platinum bob
    ctx.fillStyle = "#f2ecff";
    ctx.fillRect(x + 5, y - 58, 17, 5);
    ctx.fillRect(x + 4, y - 55, 6, 12);
    ctx.fillRect(x + 20, y - 56, 3, 4);
    ctx.fillStyle = "#cfc4e8"; ctx.fillRect(x + 4, y - 45, 6, 2);
    // gold earring
    ctx.fillStyle = "#ffd25a"; ctx.fillRect(x + 11, y - 44, 2, 3);
  }

  function drawObs(o) {
    const y = GROUND;
    if (o.type === "cone") {
      ctx.fillStyle = "#ff8a3d";
      ctx.beginPath(); ctx.moveTo(o.x + o.w / 2, y - o.h); ctx.lineTo(o.x + o.w - 2, y - 3); ctx.lineTo(o.x + 2, y - 3); ctx.fill();
      ctx.fillStyle = "#ff8a3d"; ctx.fillRect(o.x - 2, y - 4, o.w + 4, 4);
      ctx.fillStyle = "#fff1e6"; ctx.fillRect(o.x + 7, y - 19, o.w - 14, 5);
    } else if (o.type === "car") {
      ctx.fillStyle = "#ff4fa3"; ctx.fillRect(o.x, y - 26, o.w, 18);
      ctx.fillRect(o.x + 18, y - o.h, o.w - 38, 15);
      ctx.fillStyle = "#170c29"; ctx.fillRect(o.x + 22, y - o.h + 3, 20, 10); ctx.fillRect(o.x + 46, y - o.h + 3, 14, 10);
      ctx.fillStyle = "#ffe08a"; ctx.fillRect(o.x, y - 22, 5, 5);
      ctx.fillStyle = "#0d0d12";
      ctx.beginPath(); ctx.arc(o.x + 20, y - 6, 7, 0, 7); ctx.arc(o.x + o.w - 20, y - 6, 7, 0, 7); ctx.fill();
    } else {
      const blink = Math.floor(S.tick / 6) % 2;
      ctx.fillStyle = "#13204a";
      ctx.fillRect(o.x + 2, y - 38, 22, 22);
      ctx.fillRect(o.x + 4, y - 16, 7, 16); ctx.fillRect(o.x + 15, y - 16, 7, 16);
      ctx.fillStyle = "#e9b48c"; ctx.fillRect(o.x + 5, y - 50, 15, 12);
      ctx.fillStyle = "#13204a"; ctx.fillRect(o.x + 3, y - 53, 19, 5);
      ctx.fillStyle = "#ffe08a"; ctx.fillRect(o.x + 7, y - 33, 4, 4);
      ctx.fillStyle = blink ? "#ff4fa3" : "#4f8bff"; ctx.fillRect(o.x + 10, y - 57, 6, 4);
      ctx.fillStyle = "#0d0d12"; ctx.fillRect(o.x - 6, y - 34, 9, 4);
    }
  }

  function drawHud() {
    ctx.textBaseline = "top";
    ctx.font = "700 24px 'Chakra Petch', monospace";
    ctx.fillStyle = "#fff1e6"; ctx.textAlign = "left";
    ctx.fillText(String(Core.score(S)).padStart(6, "0"), 18, 16);
    ctx.font = "500 14px 'Chakra Petch', monospace";
    ctx.fillStyle = "rgba(255,241,230,.7)";
    ctx.fillText("POLIS " + S.kills, 20, 46);
    const lvl = Core.wanted(S);
    ctx.textAlign = "right";
    ctx.font = "26px system-ui, sans-serif";
    let stars = ""; for (let i = 0; i < 5; i++) stars += i < lvl ? "★" : "☆";
    ctx.fillStyle = lvl ? "#ffe08a" : "rgba(255,241,230,.45)";
    ctx.fillText(stars, W - 18, 14);
  }

  function draw() {
    ctx.save();
    if (shake > 0) ctx.translate(rnd(-shake, shake) / 3, rnd(-shake, shake) / 3);
    drawBg();
    for (const o of S.obs) drawObs(o);
    ctx.fillStyle = "#ffe08a";
    for (const b of S.bullets) ctx.fillRect(b.x, b.y, 12, 3);
    if (!(state === "over" && shake > 6)) drawVera();
    for (const p of parts) { ctx.fillStyle = p.color; ctx.fillRect(p.x, p.y, 4, 4); }
    if (state !== "idle") drawHud();
    ctx.restore();
  }

  // ---------- Ranking ----------
  const myHandle = () => (store.get("vr-handle") || "").toLowerCase();
  async function loadTop() {
    try {
      const r = await fetch("/api/top", { cache: "no-store" });
      if (!r.ok) throw 0;
      const rows = await r.json();
      const ol = $("board"); ol.textContent = "";
      $("board-empty").hidden = rows.length > 0;
      $("board-empty").textContent = "Todavía no hay puntuaciones. Juega y ponte el primero.";
      rows.forEach((row, i) => {
        const li = document.createElement("li");
        if (i === 0) li.classList.add("first");
        if (row.handle.toLowerCase() === myHandle()) li.classList.add("me");
        const pos = document.createElement("span"); pos.className = "pos"; pos.textContent = i + 1;
        const nm = document.createElement("span"); nm.className = "name"; nm.textContent = row.handle;
        const pts = document.createElement("span"); pts.className = "pts"; pts.textContent = fmt(row.score);
        li.append(pos, nm, pts); ol.append(li);
      });
    } catch {
      $("board-empty").hidden = false;
      $("board-empty").textContent = "No se pudo cargar el ranking. Se reintentará solo.";
    }
  }
  loadTop();
  setInterval(() => { if (!document.hidden) loadTop(); }, 15000);

  $("handle").value = store.get("vr-handle") || "";
  $("save-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = $("save-msg"), btn = $("btn-save");
    const raw = $("handle").value.trim();
    const m = raw.match(/^@?([A-Za-z0-9_]{1,15})$/);
    if (!m) { msg.textContent = "Escribe tu usuario de X, por ejemplo @tuusuario."; msg.className = "msg err"; $("handle").focus(); return; }
    if (!run.token) return;
    btn.disabled = true; msg.textContent = "Comprobando la partida…"; msg.className = "msg";
    try {
      const r = await fetch("/api/score", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: run.token, handle: "@" + m[1], inputs: run.inputs, ticks: S.tick, score: Core.score(S) }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { msg.textContent = j.error || "No se pudo guardar."; msg.className = "msg err"; btn.disabled = false; return; }
      store.set("vr-handle", "@" + m[1]);
      run.token = null;
      msg.textContent = j.improved
        ? `Guardado. Vas el ${j.rank}º del ranking.`
        : `Tu récord sigue siendo ${fmt(j.best)} (puesto ${j.rank}).`;
      msg.className = "msg ok";
      $("save-form").hidden = true;
      $("btn-again").focus();
      loadTop();
    } catch {
      msg.textContent = "Sin conexión. Inténtalo otra vez."; msg.className = "msg err"; btn.disabled = false;
    }
  });

  window.addEventListener("resize", fit);
  fit();
  requestAnimationFrame((t) => { last = t; requestAnimationFrame(frame); });
})();
