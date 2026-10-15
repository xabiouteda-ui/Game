// Vice Run — sound effects and a synthwave loop, all generated with WebAudio (no audio files).
window.ViceSound = (() => {
  let ac = null, master = null, musicBus = null, sfxBus = null, noiseBuf = null;
  let muted = false;
  try { muted = localStorage.getItem("vr-mute") === "1"; } catch {}

  function init() {
    if (ac) { if (ac.state === "suspended") ac.resume(); return true; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ac = new AC();
    master = ac.createGain(); master.gain.value = muted ? 0 : 0.8; master.connect(ac.destination);
    musicBus = ac.createGain(); musicBus.gain.value = 0; musicBus.connect(master);
    sfxBus = ac.createGain(); sfxBus.gain.value = 0.55; sfxBus.connect(master);
    noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return true;
  }

  function tone(type, f0, f1, dur, vol, when = 0, bus = sfxBus) {
    const t = ac.currentTime + when;
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(bus); o.start(t); o.stop(t + dur + 0.02);
  }
  function noise(dur, vol, freq, when = 0, bus = sfxBus, type = "highpass") {
    const t = ac.currentTime + when;
    const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    s.buffer = noiseBuf; f.type = type; f.frequency.value = freq;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f); f.connect(g); g.connect(bus); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
  }

  const sfx = {
    jump() { tone("square", 300, 620, 0.12, 0.12); },
    shot() { noise(0.08, 0.35, 1800); tone("square", 900, 180, 0.07, 0.08); },
    kill(combo) { const b = 440 * Math.pow(1.19, combo - 1); tone("square", b, b * 2, 0.09, 0.12); tone("square", b * 1.5, b * 3, 0.1, 0.1, 0.07); },
    coin() { tone("sine", 1320, 1320, 0.06, 0.18); tone("sine", 1760, 1760, 0.16, 0.18, 0.06); },
    land() { noise(0.05, 0.12, 400, 0, sfxBus, "lowpass"); },
    dead() { tone("sawtooth", 420, 50, 0.7, 0.22); noise(0.5, 0.35, 600, 0, sfxBus, "lowpass"); },
    star() { [523, 659, 784, 1046].forEach((f, i) => tone("triangle", f, f, 0.12, 0.12, i * 0.06)); },
  };
  function play(name, arg) { if (ac && !muted) try { sfx[name](arg); } catch {} }

  // ---------- Music: 4-chord synthwave loop at 112 bpm, scheduled ahead of time ----------
  const BPM = 112, STEP = 60 / BPM / 4; // 16th notes
  const chords = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]]; // Am F C G (midi)
  const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
  let playing = false, nextT = 0, stepN = 0, timer = null, intensity = 0;

  function schedule() {
    while (nextT < ac.currentTime + 0.15) {
      const bar = Math.floor(stepN / 16) % 4, s16 = stepN % 16, ch = chords[bar];
      const t = nextT - ac.currentTime;
      // kick on beats, snare on 2 and 4, hats on off-beats
      if (s16 % 4 === 0) tone("sine", 150, 40, 0.18, 0.5, t, musicBus);
      if (s16 === 4 || s16 === 12) noise(0.14, 0.22, 1200, t, musicBus);
      if (s16 % 2 === 1) noise(0.03, 0.06 + intensity * 0.02, 7000, t, musicBus);
      // driving 8th-note bass
      if (s16 % 2 === 0) tone("sawtooth", midi(ch[0] - 24), midi(ch[0] - 24), STEP * 1.8, 0.11, t, musicBus);
      // arpeggio gets busier as the wanted level climbs
      if (intensity >= 1 || s16 % 4 === 0) {
        const n = ch[(stepN >> (intensity >= 1 ? 0 : 2)) % 3] + 12;
        tone("triangle", midi(n), midi(n), STEP * 1.5, 0.05 + intensity * 0.008, t, musicBus);
      }
      nextT += STEP; stepN++;
    }
  }
  function startMusic() {
    if (!ac || playing) return;
    playing = true; nextT = ac.currentTime + 0.05; stepN = 0;
    musicBus.gain.cancelScheduledValues(ac.currentTime);
    musicBus.gain.setTargetAtTime(0.55, ac.currentTime, 0.3);
    timer = setInterval(schedule, 40); schedule();
  }
  function stopMusic() {
    if (!ac || !playing) return;
    playing = false; clearInterval(timer);
    musicBus.gain.cancelScheduledValues(ac.currentTime);
    musicBus.gain.setTargetAtTime(0, ac.currentTime, 0.08);
  }
  function setIntensity(lvl) { intensity = lvl; }

  function toggleMute() {
    muted = !muted;
    try { localStorage.setItem("vr-mute", muted ? "1" : "0"); } catch {}
    if (ac) master.gain.setTargetAtTime(muted ? 0 : 0.8, ac.currentTime, 0.03);
    return muted;
  }

  return { init, play, startMusic, stopMusic, setIntensity, toggleMute, isMuted: () => muted };
})();
