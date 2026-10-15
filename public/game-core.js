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
      bullets: [],
      speed: 6.5,
      dist: 0,
      kills: 0,
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
    s.p.vy = -14.4; s.p.onGround = false;
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

  function score(s) { return Math.floor(s.dist / 10) + s.kills * 50; }
  function wanted(s) { return Math.min(5, Math.floor(score(s) / 400)); }

  function spawn(s) {
    const r = s.rand();
    const lvl = wanted(s);
    let o;
    if (r < 0.36) o = { type: "cone", w: 24, h: 34 };
    else if (r < 0.64) o = { type: "car", w: 88, h: 40 };
    else o = { type: "cop", w: 26, h: 54, walk: 1 + lvl * 0.3 };
    o.x = W + 30; o.alive = true; o.id = s.nextId++;
    s.obs.push(o);
    const f = Math.max(0.62, 1 - lvl * 0.075);
    s.spawnIn = (56 + s.rand() * 48) * f;
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
    p.vy += 0.72; p.y += p.vy;
    if (p.y >= GROUND) { p.y = GROUND; p.vy = 0; p.onGround = true; }

    s.spawnIn -= s.speed / 7;
    if (s.spawnIn <= 0) spawn(s);

    const px = p.x + 5, py = p.y - p.h + 5, pw = p.w - 10, ph = p.h - 7;
    for (const o of s.obs) {
      o.x -= s.speed + (o.type === "cop" ? o.walk : 0);
      if (!o.alive) continue;
      if (overlap(px, py, pw, ph, o.x + 4, GROUND - o.h + 4, o.w - 8, o.h - 4)) {
        s.over = true;
        s.events.push({ type: "dead", x: p.x + 14, y: p.y - 28 });
        return;
      }
    }

    for (const b of s.bullets) {
      b.x += 16 + s.speed * 0.4;
      for (const o of s.obs) {
        if (o.type !== "cop" || !o.alive || b.dead) continue;
        if (b.x > o.x - 4 && b.x < o.x + o.w + 12 && b.y > GROUND - o.h && b.y < GROUND) {
          o.alive = false; b.dead = true; s.kills++;
          s.events.push({ type: "kill", x: o.x + o.w / 2, y: GROUND - o.h / 2 });
        }
      }
    }
    s.bullets = s.bullets.filter((b) => !b.dead && b.x < W + 30);
    s.obs = s.obs.filter((o) => o.alive && o.x + o.w > -60);

    if (s.tick >= MAX_TICKS) s.over = true;
  }

  // Replay a recorded run. inputs: [[tick, "j"|"s"], ...] applied before that tick's step.
  function replay(seed, inputs) {
    const s = create(seed);
    let i = 0;
    while (!s.over) {
      while (i < inputs.length && inputs[i][0] === s.tick) {
        const a = inputs[i][1];
        const ok = a === "j" ? jump(s) : a === "s" ? shoot(s) : false;
        if (!ok) return { valid: false, reason: "input_rejected" };
        i++;
      }
      if (i < inputs.length && inputs[i][0] < s.tick) return { valid: false, reason: "input_order" };
      step(s);
      s.events.length = 0;
    }
    if (i !== inputs.length) return { valid: false, reason: "inputs_after_end" };
    return { valid: true, ticks: s.tick, score: score(s), kills: s.kills };
  }

  return { W, H, GROUND, TICKS_PER_SEC, MAX_TICKS, create, step, jump, shoot, canJump, canShoot, score, wanted, replay };
});
