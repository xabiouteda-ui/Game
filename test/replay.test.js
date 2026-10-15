// Plays runs with a simple bot, then checks the server-side replay gives the same result
// and that tampered runs are rejected.
const Core = require("../public/game-core.js");
const assert = require("assert");

function play(seed, maxTicks = 20000) {
  const s = Core.create(seed), inputs = [];
  const act = (a, fn) => { if (fn(s)) inputs.push([s.tick, a]); };
  let shortHop = false;
  while (!s.over && s.tick < maxTicks) {
    const ahead = s.obs.filter((o) => o.alive && o.x + o.w > s.p.x);
    const near = ahead.find((o) => o.type !== "drone" && o.x - s.p.x < 60 + s.speed * 6);
    const drone = ahead.find((o) => o.type === "drone" && o.x - s.p.x < 120 + s.speed * 30);
    if (near && near.type === "cop") act("s", Core.shoot);
    else if (near && near.x - s.p.x < 40 + s.speed * 4 && Core.canJump(s)) {
      act("j", Core.jump);
      shortHop = !!drone && near.type !== "barrier";
    } else if (shortHop && Core.canRelease(s) && s.p.vy > -11) act("r", Core.release);
    if (drone && !s.p.onGround && s.p.y < Core.GROUND - 70) act("s", Core.shoot);
    if (s.p.onGround) shortHop = false;
    Core.step(s); s.events.length = 0;
  }
  return { s, inputs };
}

let total = 0;
const kinds = new Set();
for (const seed of [1, 42, 123456789, 4000000000, 7, 99, 2024, 31337]) {
  const { s, inputs } = play(seed);
  const r = Core.replay(seed, inputs);
  if (!s.over) continue;
  assert.ok(r.valid, "replay valid");
  assert.strictEqual(r.score, Core.score(s));
  assert.strictEqual(r.ticks, s.tick);
  total++;
  inputs.forEach((x) => kinds.add(x[1]));
  console.log(`seed ${seed}: score ${r.score}, kills ${r.kills}, coins ${s.coinsTaken}, ${(r.ticks / 60).toFixed(1)}s ✓`);
  // removing the jumps must not reproduce the same run
  const noJumps = inputs.filter((x) => x[1] !== "j");
  const r2 = Core.replay(seed, noJumps);
  assert.ok(!r2.valid || r2.ticks !== r.ticks, "tampered run differs");
  // out-of-order inputs are rejected
  if (inputs.length > 2) assert.ok(!Core.replay(seed, inputs.slice().reverse()).valid);
}
assert.ok(total >= 4, "enough finished runs");
assert.ok(!Core.replay(1, [[0, "r"]]).valid, "release on the ground rejected");
assert.ok(!Core.replay(1, [[0, "constructor"]]).valid, "unknown action rejected");
console.log("inputs used:", [...kinds].sort().join(","));
console.log("ok");
