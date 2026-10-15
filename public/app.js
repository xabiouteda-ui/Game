(() => {
  const C = window.VICE_CONFIG || {};
  const Core = window.ViceCore;
  const Snd = window.ViceSound;
  const $ = (id) => document.getElementById(id);
  const fmt = (n) => Number(n).toLocaleString("en-US");
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
    try { await navigator.clipboard.writeText(C.ca); $("btn-copy").textContent = "Copied"; setTimeout(() => ($("btn-copy").textContent = "Copy"), 1500); }
    catch { const r = document.createRange(); r.selectNodeContents($("ca")); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
  });

  // ---------- Countdown ----------
  const target = new Date(C.launch || "2026-11-18T23:00:00Z").getTime();
  const pad2 = (n) => String(n).padStart(2, "0");
  (function tick() {
    let t = target - Date.now();
    if (t <= 0) { $("digits").innerHTML = '<span class="released">It\'s here!</span>'; return; }
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
  const JUMP_BUFFER = 8, SHOT_BUFFER = 8, MIN_HOLD = 3;
  let S = Core.create(1);
  let state = "idle";            // idle | starting | run | pause | over
  let run = { token: null, inputs: [] };
  let held = false, jumpBuf = 0, shotBuf = 0, wantRelease = false, jumpTick = -99;
  let acc = 0, last = performance.now();
  let parts = [], floats = [], flash = 0, shake = 0, comboFx = 0, lastLvl = 0;
  let topRows = [];

  const rnd = (a, b) => a + Math.random() * (b - a);
  const far = Array.from({ length: 16 }, (_, i) => ({ x: i * 80, w: rnd(50, 80), h: rnd(90, 190) }));
  const bldgs = Array.from({ length: 22 }, (_, i) => ({
    x: i * 64, w: rnd(38, 60), h: rnd(60, 160), lit: Math.floor(rnd(0, 97)),
    sign: Math.random() < 0.3 ? (Math.random() < 0.5 ? "#ff4fa3" : "#2de2c9") : null,
  }));
  const palms = Array.from({ length: 7 }, (_, i) => ({ x: i * 170 + rnd(0, 60), h: rnd(84, 120) }));
  const best = () => Number(store.get("vr-best")) || 0;

  function showBest() {
    const b = best();
    $("start-best").textContent = b ? `Your best: ${fmt(b)}` : "";
  }
  showBest();

  async function start() {
    if (state === "starting" || state === "run") return;
    state = "starting";
    if (Snd.init()) Snd.startMusic();
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
    jumpBuf = shotBuf = 0; wantRelease = false; jumpTick = -99;
    parts = []; floats = []; comboFx = 0; lastLvl = 0; acc = 0; last = performance.now();
    Snd.setIntensity(0);
    state = "run";
    cv.focus({ preventScroll: true });
  }

  function pause(on) {
    if (on && state === "run") { state = "pause"; $("ov-pause").hidden = false; Snd.stopMusic(); }
    else if (!on && state === "pause") {
      state = "run"; $("ov-pause").hidden = true; last = performance.now(); acc = 0;
      Snd.startMusic(); cv.focus({ preventScroll: true });
    }
  }

  function hideOverlays() { $("ov-start").hidden = true; $("ov-over").hidden = true; $("ov-pause").hidden = true; }

  function projectedRank(sc) {
    if (!sc) return "";
    const me = myHandle();
    const ahead = topRows.filter((r) => r.score > sc && r.handle.toLowerCase() !== me).length;
    if (ahead === 0) return "This run would put you #1 on the leaderboard.";
    if (ahead < 20) return `This run would put you #${ahead + 1} on the leaderboard.`;
    return `#20 on the leaderboard has ${fmt(topRows[topRows.length - 1].score)}. You can do it!`;
  }

  function gameOver() {
    state = "over";
    shake = 14;
    Snd.stopMusic();
    const sc = Core.score(S), prev = best();
    if (sc > prev) store.set("vr-best", String(sc));
    $("final").textContent = fmt(sc);
    $("final-record").hidden = !(sc > prev && prev > 0);
    $("final-sub").textContent =
      `${fmt(S.kills)} takedowns · ${fmt(S.coinsTaken)} coins · your best: ${fmt(Math.max(prev, sc))}`;
    $("final-rank").textContent = run.token ? projectedRank(sc) : "";
    $("save-msg").textContent = ""; $("save-msg").className = "msg";
    $("btn-save").disabled = !run.token;
    $("save-form").hidden = !run.token || sc === 0;
    if (!run.token) { $("save-msg").textContent = "No connection to the server: this run can't be saved."; $("save-msg").className = "msg err"; }
    $("handle").value = store.get("vr-handle") || "";
    showBest();
    setTimeout(() => { $("ov-over").hidden = false; cv.blur(); }, 650);
  }

  function share() {
    const sc = Core.score(S);
    const tk = C.ticker || "";
    const txt = `I scored ${fmt(sc)} in Vice Run 🌴🚓 Can you beat me? Whoever is #1 on Nov 19 wins ${C.prize || "the prize"}. ${tk}`.trim();
    const url = "https://x.com/intent/post?text=" + encodeURIComponent(txt) + "&url=" + encodeURIComponent(location.origin);
    window.open(url, "_blank", "noopener");
  }

  // ---------- Input ----------
  function pressJump() {
    if (state === "run") { if (!held) { held = true; jumpBuf = JUMP_BUFFER; wantRelease = false; } }
    else if (state === "idle") start();
  }
  function releaseJump() { if (held) { held = false; if (state === "run") wantRelease = true; } }
  function pressShoot() { if (state === "run") shotBuf = SHOT_BUFFER; }
  function toggleMute() {
    const m = Snd.toggleMute();
    $("btn-mute").textContent = m ? "🔇" : "🔊";
    $("btn-mute").setAttribute("aria-label", m ? "Unmute" : "Mute");
  }
  $("btn-mute").textContent = Snd.isMuted() ? "🔇" : "🔊";

  window.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT") return;
    const k = e.code;
    if (k === "Space" || k === "ArrowUp" || k === "KeyW") {
      e.preventDefault();
      if (!e.repeat) pressJump();
    } else if (k === "KeyF" || k === "KeyJ" || k === "ArrowRight") {
      if (state === "run") { e.preventDefault(); pressShoot(); }
    } else if (k === "KeyP" || k === "Escape") {
      if (state === "run") pause(true); else if (state === "pause") pause(false);
    } else if (k === "KeyM") {
      toggleMute();
    } else if (k === "Enter" || k === "KeyR") {
      if (state === "idle" || state === "over") { e.preventDefault(); start(); }
      else if (state === "pause") { e.preventDefault(); pause(false); }
    }
  });
  window.addEventListener("keyup", (e) => {
    if (e.code === "Space" || e.code === "ArrowUp" || e.code === "KeyW") releaseJump();
  });
  cv.addEventListener("mousedown", (e) => { if (state === "run") { e.preventDefault(); pressShoot(); } else if (state === "idle") start(); });
  cv.addEventListener("contextmenu", (e) => { if (state === "run") e.preventDefault(); });
  const bj = $("b-jump");
  bj.addEventListener("pointerdown", (e) => { e.preventDefault(); bj.setPointerCapture?.(e.pointerId); pressJump(); });
  ["pointerup", "pointercancel", "lostpointercapture"].forEach((ev) => bj.addEventListener(ev, releaseJump));
  $("b-shoot").addEventListener("pointerdown", (e) => { e.preventDefault(); pressShoot(); });
  $("btn-start").addEventListener("click", start);
  $("btn-again").addEventListener("click", start);
  $("btn-resume").addEventListener("click", () => pause(false));
  $("btn-share").addEventListener("click", share);
  $("btn-mute").addEventListener("click", (e) => { e.stopPropagation(); toggleMute(); });
  document.addEventListener("visibilitychange", () => { if (document.hidden) pause(true); });
  window.addEventListener("blur", () => { held = false; pause(true); });

  // Apply buffered input for this tick; every accepted action is recorded for the server replay.
  function applyInputs() {
    const rec = (a) => run.inputs.push([S.tick, a]);
    if (jumpBuf > 0) {
      if (Core.jump(S)) { rec("j"); jumpBuf = 0; jumpTick = S.tick; if (!held) wantRelease = true; }
      else jumpBuf--;
    }
    if (wantRelease && S.tick - jumpTick >= MIN_HOLD) {
      if (Core.release(S)) rec("r");
      wantRelease = false;
    }
    if (shotBuf > 0) {
      if (Core.shoot(S)) { rec("s"); shotBuf = 0; }
      else shotBuf--;
    }
  }

  // ---------- Loop ----------
  function frame(t) {
    let dt = t - last; last = t;
    if (dt > 250) dt = 250;
    if (state === "run") {
      acc += dt;
      while (acc >= TICK && state === "run") {
        applyInputs();
        Core.step(S);
        for (const ev of S.events) onEvent(ev);
        S.events.length = 0;
        acc -= TICK;
        const lvl = Core.wanted(S);
        if (lvl > lastLvl) { lastLvl = lvl; Snd.play("star"); Snd.setIntensity(lvl); floatText(W / 2, 110, "★".repeat(lvl) + "  HEAT RISING!", "#ffe08a", 22); }
        if (S.over) gameOver();
      }
    }
    for (const p of parts) { p.x += p.vx; p.y += p.vy; p.vy += p.g; p.life--; }
    parts = parts.filter((p) => p.life > 0);
    for (const f of floats) { f.y -= 0.7; f.life--; }
    floats = floats.filter((f) => f.life > 0);
    if (flash > 0) flash--;
    if (shake > 0) shake--;
    if (comboFx > 0) comboFx--;
    draw();
    requestAnimationFrame(frame);
  }

  function onEvent(ev) {
    if (ev.type === "kill") {
      burst(ev.x, ev.y, ev.what === "drone" ? "#ffe08a" : "#2de2c9", 16);
      floatText(ev.x, ev.y - 20, "+" + ev.pts + (ev.combo > 1 ? "  x" + ev.combo : ""), ev.combo > 1 ? "#ff4fa3" : "#2de2c9", 18);
      if (ev.combo > 1) { comboFx = 50; shake = Math.max(shake, 4); }
      Snd.play("kill", ev.combo);
    } else if (ev.type === "coin") {
      burst(ev.x, ev.y, "#ffd25a", 6, 0.1);
      floatText(ev.x, ev.y - 10, "+" + ev.pts, "#ffd25a", 14);
      Snd.play("coin");
    } else if (ev.type === "dead") { burst(ev.x, ev.y, "#ff4fa3", 30); Snd.play("dead"); }
    else if (ev.type === "shot") { flash = 4; Snd.play("shot"); }
    else if (ev.type === "jump") Snd.play("jump");
    else if (ev.type === "land") { dust(ev.x); Snd.play("land"); }
  }
  function burst(x, y, color, n, g = 0.3) {
    for (let i = 0; i < n; i++) parts.push({ x, y, vx: rnd(-4.5, 4.5), vy: rnd(-7, 1), g, life: rnd(22, 40), color, size: 4 });
  }
  function dust(x) {
    for (let i = 0; i < 6; i++) parts.push({ x: x + rnd(-10, 10), y: GROUND - 2, vx: rnd(-2.5, -0.5), vy: rnd(-1.5, -0.3), g: 0.05, life: rnd(14, 24), color: "rgba(255,241,230,.5)", size: 3 });
  }
  function floatText(x, y, text, color, size) { floats.push({ x, y, text, color, size, life: 50 }); }

  // ---------- Drawing ----------
  function drawBg() {
    const d = S.dist, lvl = Core.wanted(S);
    const g = ctx.createLinearGradient(0, 0, 0, GROUND);
    g.addColorStop(0, "#241341"); g.addColorStop(0.5, "#8f2f74"); g.addColorStop(1, "#ffb347");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, GROUND);
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
    // far skyline
    const spanF = 16 * 80, oF = (d * 0.06) % spanF;
    ctx.fillStyle = "rgba(53,25,90,.55)";
    for (const b of far) { let x = b.x - oF; if (x < -90) x += spanF; ctx.fillRect(x, GROUND - b.h, b.w, b.h); }
    // near skyline with lit windows and neon signs
    const span1 = 22 * 64, o1 = (d * 0.15) % span1;
    for (const b of bldgs) {
      let x = b.x - o1; if (x < -70) x += span1;
      ctx.fillStyle = "#35195a"; ctx.fillRect(x, GROUND - b.h, b.w, b.h);
      ctx.fillStyle = "rgba(255,179,71,.55)";
      let n = b.lit;
      for (let wy = GROUND - b.h + 10; wy < GROUND - 16; wy += 16)
        for (let wx = x + 6; wx < x + b.w - 8; wx += 12) { n = (n * 31 + 7) % 97; if (n < 22) ctx.fillRect(wx, wy, 4, 6); }
      if (b.sign) {
        ctx.save(); ctx.shadowColor = b.sign; ctx.shadowBlur = 10; ctx.fillStyle = b.sign;
        ctx.fillRect(x + 4, GROUND - b.h - 8, b.w - 8, 3); ctx.restore();
      }
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
    // speed lines once things get fast
    if (S.speed > 11 && state === "run") {
      ctx.fillStyle = `rgba(255,241,230,${Math.min(0.35, (S.speed - 11) / 20)})`;
      for (let i = 0; i < 8; i++) {
        const y = 30 + ((i * 97 + S.tick * 3) % 250), x = (W - ((S.tick * (20 + i * 3) + i * 211) % (W + 200)));
        ctx.fillRect(x, y, 60 + i * 6, 2);
      }
    }
    // police lights wash at high wanted levels
    if (lvl >= 3 && state === "run") {
      const blue = Math.floor(S.tick / 10) % 2;
      const a = 0.05 + (lvl - 3) * 0.03;
      const lg = ctx.createLinearGradient(blue ? 0 : W, 0, blue ? W * 0.4 : W * 0.6, 0);
      lg.addColorStop(0, blue ? `rgba(79,139,255,${a})` : `rgba(255,59,90,${a})`); lg.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = lg; ctx.fillRect(0, 0, W, H);
    }
  }

  // Vera: original protagonist — platinum bob, teal crop jacket, white shorts, pink sneakers
  function drawVera() {
    const p = S.p, x = p.x, y = p.y;
    const pose = !p.onGround ? 2 : Math.floor(S.tick / 5) % 2;
    const bob = p.onGround ? (Math.floor(S.tick / 5) % 2) : 0;
    const skin = "#d99a73";
    // shadow
    ctx.fillStyle = "rgba(0,0,0,.35)";
    const sh = Math.max(0.3, 1 - (GROUND - y) / 160);
    ctx.beginPath(); ctx.ellipse(x + 14, GROUND + 3, 16 * sh, 4 * sh, 0, 0, Math.PI * 2); ctx.fill();
    ctx.save(); ctx.translate(0, -bob);
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
    // jacket tail flapping in the wind
    ctx.fillStyle = "#2de2c9"; ctx.fillRect(x, y - 36 + (Math.floor(S.tick / 4) % 2) * 2, 4, 6);
    // arm + pistol
    ctx.fillStyle = "#2de2c9"; ctx.fillRect(x + 20, y - 40, 8, 6);
    ctx.fillStyle = skin; ctx.fillRect(x + 27, y - 39, 6, 5);
    ctx.fillStyle = "#0d0d12"; ctx.fillRect(x + 31, y - 42, 11, 5); ctx.fillRect(x + 32, y - 38, 3, 4);
    if (flash > 0) { ctx.fillStyle = "#ffe08a"; ctx.fillRect(x + 42, y - 44, 8, 8); ctx.fillStyle = "#fff"; ctx.fillRect(x + 44, y - 42, 4, 4); }
    // head
    ctx.fillStyle = skin; ctx.fillRect(x + 7, y - 54, 15, 12);
    ctx.fillStyle = "#0d0d12"; ctx.fillRect(x + 12, y - 50, 11, 3);       // sunglasses
    ctx.fillStyle = "#c23a5e"; ctx.fillRect(x + 18, y - 45, 3, 1);        // lips
    // platinum bob, a little lift when airborne
    const lift = p.onGround ? 0 : 2;
    ctx.fillStyle = "#f2ecff";
    ctx.fillRect(x + 5, y - 58, 17, 5);
    ctx.fillRect(x + 4 - lift, y - 55 - lift, 6, 12);
    ctx.fillRect(x + 20, y - 56, 3, 4);
    ctx.fillStyle = "#cfc4e8"; ctx.fillRect(x + 4 - lift, y - 45 - lift, 6, 2);
    // gold earring
    ctx.fillStyle = "#ffd25a"; ctx.fillRect(x + 11, y - 44, 2, 3);
    ctx.restore();
  }

  function drawObs(o) {
    const y = GROUND;
    const blink = Math.floor(S.tick / 6) % 2;
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
    } else if (o.type === "barrier") {
      // police roadblock: two posts, striped boards, a beacon on top
      ctx.fillStyle = "#3a3550"; ctx.fillRect(o.x + 2, y - o.h + 8, 5, o.h - 8); ctx.fillRect(o.x + o.w - 7, y - o.h + 8, 5, o.h - 8);
      for (const by of [y - o.h + 10, y - o.h + 32]) {
        ctx.fillStyle = "#fff1e6"; ctx.fillRect(o.x - 3, by, o.w + 6, 12);
        ctx.fillStyle = "#ff3b5a";
        for (let sx = 0; sx < o.w + 6; sx += 12) ctx.fillRect(o.x - 3 + sx, by, 6, 12);
      }
      ctx.fillStyle = blink ? "#ff3b5a" : "#4f8bff"; ctx.fillRect(o.x + o.w / 2 - 4, y - o.h, 8, 8);
    } else if (o.type === "drone") {
      const t = o.top, spin = Math.floor(S.tick / 2) % 2;
      ctx.fillStyle = "#1c2140"; ctx.fillRect(o.x + 8, t + 8, o.w - 16, 12);
      ctx.fillStyle = "#3a3550"; ctx.fillRect(o.x + 2, t + 4, o.w - 4, 3);
      ctx.fillStyle = "rgba(255,241,230,.7)";
      ctx.fillRect(o.x + (spin ? 0 : 4), t + 1, 12, 2); ctx.fillRect(o.x + o.w - 12 - (spin ? 0 : 4), t + 1, 12, 2);
      ctx.fillStyle = blink ? "#ff3b5a" : "#4f8bff"; ctx.fillRect(o.x + o.w / 2 - 3, t + 20, 6, 4);
      ctx.fillStyle = "#ffe08a"; ctx.fillRect(o.x + 10, t + 12, 4, 4);
      // searchlight cone
      ctx.fillStyle = "rgba(255,224,138,.07)";
      ctx.beginPath(); ctx.moveTo(o.x + 14, t + 20); ctx.lineTo(o.x - 30, GROUND); ctx.lineTo(o.x + 40, GROUND); ctx.fill();
    } else {
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

  function drawCoins() {
    const sym = (C.ticker || "$").replace(/[^A-Za-z$]/g, "").charAt(0) || "$";
    for (const c of S.coins) {
      const wob = Math.abs(((S.tick + c.x) / 8) % 4 - 2) / 2; // fake spin
      const w = 4 + 12 * wob;
      ctx.fillStyle = "#c98a1a"; ctx.fillRect(c.x + 8 - w / 2, c.y + 1, w, 15);
      ctx.fillStyle = "#ffd25a"; ctx.fillRect(c.x + 8 - w / 2, c.y, w, 14);
      if (w > 9) {
        ctx.fillStyle = "#8a5a00"; ctx.font = "700 11px 'Chakra Petch', monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(sym, c.x + 8, c.y + 7.5);
      }
    }
  }

  function drawHud() {
    ctx.textBaseline = "top";
    ctx.font = "700 24px 'Chakra Petch', monospace";
    ctx.fillStyle = "#fff1e6"; ctx.textAlign = "left";
    const sc = Core.score(S);
    ctx.fillText(String(sc).padStart(6, "0"), 18, 16);
    ctx.font = "500 14px 'Chakra Petch', monospace";
    ctx.fillStyle = "rgba(255,241,230,.75)";
    ctx.fillText(`TAKEDOWNS ${S.kills}   COINS ${S.coinsTaken}`, 20, 46);
    // target: the current nº 1 (or your record if the board is empty)
    const leader = topRows[0];
    const goal = leader ? leader.score : best();
    if (goal > 0) {
      ctx.fillStyle = sc > goal ? "#2de2c9" : "rgba(255,241,230,.55)";
      ctx.fillText(sc > goal ? (leader ? "YOU'RE #1!" : "NEW BEST!") : (leader ? "#1: " : "BEST: ") + fmt(goal), 20, 66);
    }
    // combo timer bar
    const since = S.tick - S.lastKillTick;
    if (S.combo >= 1 && since <= Core.COMBO_WINDOW) {
      const frac = 1 - since / Core.COMBO_WINDOW;
      ctx.fillStyle = "rgba(255,241,230,.15)"; ctx.fillRect(W / 2 - 60, 18, 120, 6);
      ctx.fillStyle = "#ff4fa3"; ctx.fillRect(W / 2 - 60, 18, 120 * frac, 6);
      ctx.textAlign = "center"; ctx.font = "700 14px 'Chakra Petch', monospace";
      ctx.fillStyle = "#ff4fa3"; ctx.fillText("COMBO x" + Math.min(4, S.combo + 1) + " ON NEXT TAKEDOWN", W / 2, 28);
    }
    const lvl = Core.wanted(S);
    ctx.textAlign = "right";
    ctx.font = "26px system-ui, sans-serif";
    let stars = ""; for (let i = 0; i < 5; i++) stars += i < lvl ? "★" : "☆";
    ctx.fillStyle = lvl ? "#ffe08a" : "rgba(255,241,230,.45)";
    ctx.fillText(stars, W - 60, 14);
  }

  function drawFloats() {
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    for (const f of floats) {
      ctx.globalAlpha = Math.min(1, f.life / 20);
      ctx.font = `700 ${f.size}px 'Chakra Petch', monospace`;
      ctx.fillStyle = "rgba(23,12,41,.8)"; ctx.fillText(f.text, f.x + 2, f.y + 2);
      ctx.fillStyle = f.color; ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1;
    if (comboFx > 0 && S.combo > 1) {
      const sz = 40 + (comboFx > 40 ? (comboFx - 40) * 2 : 0);
      ctx.globalAlpha = Math.min(1, comboFx / 15);
      ctx.font = `${sz}px 'Bungee', Impact, sans-serif`;
      ctx.fillStyle = "#170c29"; ctx.fillText("COMBO x" + S.combo, W / 2 + 3, 133);
      ctx.fillStyle = "#ff4fa3"; ctx.fillText("COMBO x" + S.combo, W / 2, 130);
      ctx.globalAlpha = 1;
    }
  }

  function draw() {
    ctx.save();
    if (shake > 0) ctx.translate(rnd(-shake, shake) / 3, rnd(-shake, shake) / 3);
    drawBg();
    drawCoins();
    for (const o of S.obs) drawObs(o);
    ctx.fillStyle = "#ffe08a";
    for (const b of S.bullets) { ctx.fillRect(b.x, b.y, 12, 3); ctx.fillStyle = "rgba(255,224,138,.35)"; ctx.fillRect(b.x - 14, b.y + 1, 14, 1); ctx.fillStyle = "#ffe08a"; }
    if (!(state === "over" && shake > 6)) drawVera();
    for (const p of parts) { ctx.fillStyle = p.color; ctx.fillRect(p.x, p.y, p.size, p.size); }
    if (state !== "idle") { drawHud(); drawFloats(); }
    ctx.restore();
  }

  // ---------- Ranking ----------
  const myHandle = () => (store.get("vr-handle") || "").toLowerCase();
  async function loadTop() {
    try {
      const r = await fetch("/api/top", { cache: "no-store" });
      if (!r.ok) throw 0;
      const rows = await r.json();
      topRows = rows;
      const ol = $("board"); ol.textContent = "";
      $("board-empty").hidden = rows.length > 0;
      $("board-empty").textContent = "No scores yet. Play and take the top spot.";
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
      $("board-empty").textContent = "Couldn't load the leaderboard. Retrying automatically.";
    }
  }
  loadTop();
  setInterval(() => { if (!document.hidden && state !== "run") loadTop(); }, 15000);

  $("handle").value = store.get("vr-handle") || "";
  $("save-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = $("save-msg"), btn = $("btn-save");
    const raw = $("handle").value.trim();
    const m = raw.match(/^@?([A-Za-z0-9_]{1,15})$/);
    if (!m) { msg.textContent = "Enter your X handle, e.g. @yourhandle."; msg.className = "msg err"; $("handle").focus(); return; }
    if (!run.token) return;
    btn.disabled = true; msg.textContent = "Verifying your run…"; msg.className = "msg";
    try {
      const r = await fetch("/api/score", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: run.token, handle: "@" + m[1], inputs: run.inputs, ticks: S.tick, score: Core.score(S) }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { msg.textContent = j.error || "Couldn't save."; msg.className = "msg err"; btn.disabled = false; return; }
      store.set("vr-handle", "@" + m[1]);
      run.token = null;
      msg.textContent = j.improved
        ? `Saved. You're #${j.rank} on the leaderboard.`
        : `Your best is still ${fmt(j.best)} (#${j.rank}).`;
      msg.className = "msg ok";
      $("save-form").hidden = true;
      $("final-rank").textContent = "";
      $("btn-again").focus();
      loadTop();
    } catch {
      msg.textContent = "No connection. Try again."; msg.className = "msg err"; btn.disabled = false;
    }
  });

  window.addEventListener("resize", fit);
  fit();
  requestAnimationFrame((t) => { last = t; requestAnimationFrame(frame); });
})();
