// Vice Run — deterministic game simulation.
// Shared by the browser (to play) and the server (to replay and verify a run).
// Only uses + - * / and Math.floor/min/max/imul, so results are identical everywhere.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ViceCore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const W = 960, H = 360, GROUND = 300;
  const TICKS_PER_SEC = 60;
  const MAX_TICKS = TICKS_PER_SEC * 60 * 45; // 45 minutes max per run
  const SHOT_COOLDOWN = 13;
  const JUMP_V = -14.4, CUT_V = -7, GRAVITY = 0.72;
  const COIN_PTS = 25, KILL_PTS = 50, COMBO_WINDOW = 150, MAX_COMBO = 4;

  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function create(seed) {
    return {
      rand: rng(seed),
      tick: 0,
      p: { x: 140, y: GROUND, vy: 0, w: 28, h: 54, onGround: true },
      obs: [],
      coins: [],
      bullets: [],
      speed: 6.5,
      dist: 0,
      kills: 0,
      coinsTaken: 0,
      bonus: 0,
      combo: 0,
      lastKillTick: -999,
      lastType: "",
      spawnIn: 80,
      lastShotTick: -999,
      over: false,
      events: [],
      nextId: 1,
    };
  }

  function canJump(s) { return !s.over && s.p.onGround; }
  function jump(s) {
    if (!canJump(s)) return false;
    s.p.vy = JUMP_V; s.p.onGround = false;
    s.events.push({ type: "jump" });
    return true;
  }
  // Letting go of jump early cuts the climb short (short hop).
  function canRelease(s) { return !s.over && !s.p.onGround && s.p.vy < CUT_V; }
  function release(s) {
    if (!canRelease(s)) return false;
    s.p.vy = CUT_V;
    return true;
  }
  function canShoot(s) { return !s.over && s.tick - s.lastShotTick >= SHOT_COOLDOWN; }
  function shoot(s) {
    if (!canShoot(s)) return false;
    s.lastShotTick = s.tick;
    s.bullets.push({ x: s.p.x + s.p.w + 12, y: s.p.y - 36 });
    s.events.push({ type: "shot" });
    return true;
  }

  function score(s) { return Math.floor(s.dist / 10) + s.bonus; }
  function wanted(s) { return Math.min(5, Math.floor(score(s) / 400)); }
  function shootable(o) { return o.type === "cop" || o.type === "drone"; }

  function spawn(s) {
    const r = s.rand();
    const lvl = wanted(s);
    let type;
    if (r < 0.3) type = "cone";
    else if (r < 0.52) type = "car";
    else if (r < 0.8) type = "cop";
    else if (r < 0.9) type = lvl >= 1 ? "barrier" : "cone";
    else type = lvl >= 2 ? "drone" : "cop";
    // A drone limits how high you can jump, so never pair it with a tall obstacle.
    if (type === "drone" && (s.lastType === "barrier" || s.lastType === "car")) type = "cone";
    if (type === "barrier" && s.lastType === "drone") type = "cone";

    let o;
    if (type === "cone") o = { w: 24, h: 34 };
    else if (type === "car") o = { w: 88, h: 40 };
    else if (type === "cop") o = { w: 26, h: 54, walk: 1 + lvl * 0.3 };
    else if (type === "barrier") o = { w: 30, h: 62 };
    else o = { w: 40, h: 26, walk: 1.5, top: GROUND - 135 };
    o.type = type;
    if (o.top === undefined) o.top = GROUND - o.h;
    o.x = W + 30; o.alive = true; o.id = s.nextId++;
    s.obs.push(o);
    s.lastType = type;

    // Coin arcs over things you jump, as a reward for clean jumps.
    if ((type === "cone" || type === "car" || type === "barrier") && s.rand() < 0.45) {
      const cx = o.x + o.w / 2, rise = type === "barrier" ? 105 : 80;
      for (let i = -2; i <= 2; i++) {
        const k = (i * i) / 4;
        s.coins.push({ x: cx + i * 34 - 8, y: GROUND - 30 - rise * (1 - k), taken: false });
      }
    }

    const f = Math.max(0.62, 1 - lvl * 0.075);
    s.spawnIn = (56 + s.rand() * 48) * f * (type === "drone" ? 1.25 : 1);
  }

  function overlap(ax, ay, aw, ah, bx, by, bw, bh) {
    return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
  }

  // Advance exactly one tick (1/60 s).
  function step(s) {
    if (s.over) return;
    s.tick++;
    s.speed = Math.min(18, 6.5 + s.dist / 2800);
    s.dist += s.speed;

    const p = s.p;
    p.vy += GRAVITY; p.y += p.vy;
    if (p.y >= GROUND) {
      if (!p.onGround) s.events.push({ type: "land", x: p.x + 14 });
      p.y = GROUND; p.vy = 0; p.onGround = true;
    }

    s.spawnIn -= s.speed / 7;
    if (s.spawnIn <= 0) spawn(s);

    const px = p.x + 5, py = p.y - p.h + 5, pw = p.w - 10, ph = p.h - 7;
    for (const o of s.obs) {
      o.x -= s.speed + (o.walk || 0);
      if (!o.alive) continue;
      if (overlap(px, py, pw, ph, o.x + 4, o.top + 4, o.w - 8, o.h - 4)) {
        s.over = true;
        s.events.push({ type: "dead", x: p.x + 14, y: p.y - 28 });
        return;
      }
    }

    for (const c of s.coins) {
      c.x -= s.speed;
      if (!c.taken && overlap(px - 4, py - 4, pw + 8, ph + 8, c.x, c.y, 16, 16)) {
        c.taken = true; s.coinsTaken++; s.bonus += COIN_PTS;
        s.events.push({ type: "coin", x: c.x + 8, y: c.y + 8, pts: COIN_PTS });
      }
    }

    for (const b of s.bullets) {
      b.x += 16 + s.speed * 0.4;
      for (const o of s.obs) {
        if (!shootable(o) || !o.alive || b.dead) continue;
        if (b.x > o.x - 4 && b.x < o.x + o.w + 12 && b.y > o.top && b.y < o.top + o.h) {
          o.alive = false; b.dead = true; s.kills++;
          s.combo = s.tick - s.lastKillTick <= COMBO_WINDOW ? Math.min(MAX_COMBO, s.combo + 1) : 1;
          s.lastKillTick = s.tick;
          const pts = KILL_PTS * s.combo;
          s.bonus += pts;
          s.events.push({ type: "kill", x: o.x + o.w / 2, y: o.top + o.h / 2, pts, combo: s.combo, what: o.type });
        }
      }
    }
    s.bullets = s.bullets.filter((b) => !b.dead && b.x < W + 30);
    s.obs = s.obs.filter((o) => o.alive && o.x + o.w > -60);
    s.coins = s.coins.filter((c) => !c.taken && c.x > -40);

    if (s.tick >= MAX_TICKS) s.over = true;
  }

  const ACTIONS = { j: jump, r: release, s: shoot };

  // Replay a recorded run. inputs: [[tick, "j"|"r"|"s"], ...] applied before that tick's step.
  function replay(seed, inputs) {
    const s = create(seed);
    let i = 0;
    while (!s.over) {
      while (i < inputs.length && inputs[i][0] === s.tick) {
        const a = inputs[i][1];
        const fn = Object.prototype.hasOwnProperty.call(ACTIONS, a) && ACTIONS[a];
        if (!fn || !fn(s)) return { valid: false, reason: "input_rejected" };
        i++;
      }
      if (i < inputs.length && inputs[i][0] < s.tick) return { valid: false, reason: "input_order" };
      step(s);
      s.events.length = 0;
    }
    if (i !== inputs.length) return { valid: false, reason: "inputs_after_end" };
    return { valid: true, ticks: s.tick, score: score(s), kills: s.kills };
  }

  return {
    W, H, GROUND, TICKS_PER_SEC, MAX_TICKS, COMBO_WINDOW,
    create, step, jump, release, shoot, canJump, canRelease, canShoot, score, wanted, replay,
  };
});
