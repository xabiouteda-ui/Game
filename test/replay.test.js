// Plays a run with a simple bot, then checks the server-side replay gives the same result
// and that a tampered run is rejected.
const Core = require("../public/game-core.js");
const assert = require("assert");
function play(seed) {
  const s = Core.create(seed), inputs = [];
  while (!s.over && s.tick < 20000) {
    const near = s.obs.find((o) => o.alive && o.x > s.p.x && o.x - s.p.x < 60 + s.speed * 6);
    if (near && near.type === "cop" && Core.shoot(s)) inputs.push([s.tick, "s"]);
    else if (near && near.type !== "cop" && near.x - s.p.x < 40 + s.speed * 4 && Core.jump(s)) inputs.push([s.tick, "j"]);
    Core.step(s); s.events.length = 0;
  }
  return { s, inputs };
}
for (const seed of [1, 42, 123456789, 4000000000]) {
  const { s, inputs } = play(seed);
  const r = Core.replay(seed, inputs);
  if (!s.over) continue;
  assert.ok(r.valid, "replay valid");
  assert.strictEqual(r.score, Core.score(s));
  assert.strictEqual(r.ticks, s.tick);
  console.log(`seed ${seed}: score ${r.score}, kills ${r.kills}, ${(r.ticks / 60).toFixed(1)}s ✓`);
  // removing the jumps must not reproduce the same run
  const noJumps = inputs.filter((x) => x[1] !== "j");
  const r2 = Core.replay(seed, noJumps);
  assert.ok(!r2.valid || r2.ticks !== r.ticks, "tampered run differs");
  // out-of-order inputs are rejected
  if (inputs.length > 2) assert.ok(!Core.replay(seed, inputs.slice().reverse()).valid);
}
console.log("ok");
