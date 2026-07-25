// Sound. gamekit's synth plus this game's own noises, wired straight to the
// engine's event stream — game.js has no idea any of this exists.
//
// A turn-based game is quiet by nature, so every event gets a distinct short
// sound: you can follow the bugs' turn with your eyes shut.

const Sfx = GK.Sfx;

Object.assign(Sfx, {
  select()  { this.tone({ freq: 620, type: "sine", dur: 0.05, vol: 0.08 }); },
  step()    { this.tone({ freq: 300, type: "triangle", dur: 0.05, vol: 0.06, slide: 60 }); },
  hop()     { this.tone({ freq: 380, type: "square", dur: 0.09, vol: 0.09, slide: 240 }); },
  whack()   {
    this.noise({ dur: 0.06, vol: 0.09 });
    this.tone({ freq: 200, type: "square", dur: 0.09, vol: 0.11, slide: -90 });
  },
  hurt()    { this.tone({ freq: 240, type: "sawtooth", dur: 0.1, vol: 0.08, slide: -120 }); },
  splash()  {
    this.noise({ dur: 0.22, vol: 0.12 });
    this.tone({ freq: 520, type: "sine", dur: 0.2, vol: 0.07, slide: -320 });
  },
  crumble() { this.noise({ dur: 0.18, vol: 0.1 }); },
  zap()     { this.tone({ freq: 880, type: "square", dur: 0.12, vol: 0.1, slide: 420 }); },
  gulp()    { this.tone({ freq: 300, type: "sine", dur: 0.14, vol: 0.11, slide: 380 }); },
  sparkle() {
    [660, 880, 1180].forEach((f, i) =>
      this.tone({ freq: f, type: "sine", dur: 0.12, vol: 0.07, when: i * 0.05 }));
  },
  berry()   {
    [523, 784, 1047].forEach((f, i) =>
      this.tone({ freq: f, type: "triangle", dur: 0.12, vol: 0.1, when: i * 0.06 }));
  },
  down()    { this.tone({ freq: 300, type: "triangle", dur: 0.3, vol: 0.1, slide: -180 }); },
  bugDown() { this.tone({ freq: 420, type: "square", dur: 0.16, vol: 0.09, slide: -220 }); },
  newTurn() { this.tone({ freq: 520, type: "sine", dur: 0.09, vol: 0.07, slide: 120 }); },
  bugTurn() { this.tone({ freq: 190, type: "sawtooth", dur: 0.13, vol: 0.06, slide: -40 }); },
  bossRoar() {
    this.tone({ freq: 110, type: "sawtooth", dur: 0.5, vol: 0.13, slide: -40 });
    this.noise({ dur: 0.4, vol: 0.09, when: 0.05 });
  },
  victory() {
    [523, 659, 784, 1047].forEach((f, i) =>
      this.tone({ freq: f, type: "triangle", dur: 0.2, vol: 0.12, when: i * 0.11 }));
  },
  defeat() {
    [440, 392, 330, 262].forEach((f, i) =>
      this.tone({ freq: f, type: "sine", dur: 0.24, vol: 0.1, when: i * 0.13 }));
  },
  stars(n) {
    for (let i = 0; i < Math.max(1, n); i++)
      this.tone({ freq: 660 + i * 220, type: "square", dur: 0.16, vol: 0.12, when: i * 0.16 });
  },
});

/* ================= Music =================
 * Two synthesized tracks: a pottering garden tune for normal levels and a
 * heavier one for bosses. Notes are semitones over a root, in 8th-note steps
 * (bass loops 32, lead loops 64), and a lookahead pump schedules them on the
 * WebAudio clock rather than firing a timer per note — a setInterval per note
 * drifts, and a background tab throttles it to ~1Hz, which turns a tune into a
 * machine gun the moment you come back.
 *
 * Both tracks are pentatonic, so nothing can clash with the sound effects
 * landing on top of them.
 */
const TRACKS = {
  garden: {
    bpm: 96, root: 262, leadType: "triangle", bassType: "sine",   // C major pentatonic
    bass: [-24, null, null, null, -17, null, -24, null, -24, null, null, null, -15, null, -17, null,
           -24, null, null, null, -17, null, -24, null, -20, null, null, null, -17, null, -12, null],
    lead: [0, null, 4, null, 7, null, null, null, 9, null, 7, null, 4, null, null, null,
           7, null, 9, null, 12, null, null, null, 9, null, 7, null, 4, null, 2, null,
           0, null, 4, null, 7, null, 9, null, 12, null, null, null, 9, null, 7, null,
           4, null, 7, null, 4, null, 0, null, 0, null, null, null, null, null, null, null],
  },
  boss: {
    bpm: 118, root: 220, leadType: "square", bassType: "sawtooth",  // A minor pentatonic
    bass: [-24, null, -24, null, -24, null, -17, null, -24, null, -24, null, -15, null, -17, null,
           -24, null, -24, null, -24, null, -17, null, -22, null, -22, null, -17, null, -17, null],
    lead: [0, null, 3, null, 0, null, 7, null, 5, null, 3, null, 0, null, null, null,
           0, null, 3, null, 5, null, 7, null, 10, null, 7, null, 5, null, 3, null,
           0, null, 3, null, 0, null, 7, null, 12, null, 10, null, 7, null, 5, null,
           3, null, 0, null, -2, null, 0, null, 0, null, null, null, null, null, null, null],
  },
};

const Music = {
  enabled: true,              // separate from Sfx.enabled; persisted in settings
  _pump: null, _step: 0, _nextT: 0, _trk: null, _kind: null,

  start(kind) {
    if (this._kind === kind && this._pump) return;    // already playing this one
    this.stop();
    this._trk = TRACKS[kind] || TRACKS.garden;
    this._kind = kind;
    this._step = 0;
    this._nextT = Sfx.ctx ? Sfx.ctx.currentTime + 0.15 : 0;
    this._pump = setInterval(() => this.pump(), 110);
  },

  stop() {
    if (this._pump) { clearInterval(this._pump); this._pump = null; }
    this._kind = null;
  },

  pump() {
    if (!Sfx.ctx || !this._trk) return;
    const now = Sfx.ctx.currentTime;
    if (!Sfx.enabled || !this.enabled || !View.running || document.hidden) {
      this._nextT = Math.max(this._nextT, now + 0.15);   // hold place, resume clean
      return;
    }
    const stepDur = 60 / this._trk.bpm / 2;              // 8th notes
    // Fell badly behind (frame hitch, throttled timer)? Skip the missed notes
    // silently instead of firing them all at once.
    while (this._nextT < now - 0.05) { this._step++; this._nextT += stepDur; }
    while (this._nextT < now + 0.6) {
      this.scheduleStep(this._step, Math.max(0, this._nextT - now), stepDur);
      this._step++;
      this._nextT += stepDur;
    }
  },

  scheduleStep(s, when, stepDur) {
    const t = this._trk;
    const note = (semi) => t.root * Math.pow(2, semi / 12);

    const b = t.bass[s % 32];
    if (b != null) Sfx.tone({ freq: note(b), type: t.bassType, dur: stepDur * 1.8, vol: 0.055, when });

    const l = t.lead[s % 64];
    if (l != null) Sfx.tone({ freq: note(l), type: t.leadType, dur: stepDur * 1.5, vol: 0.05, when });

    // A soft tick on the beat keeps the pulse without a drum kit.
    if (s % 4 === 0) Sfx.noise({ dur: 0.02, vol: this._kind === "boss" ? 0.035 : 0.018, when });
    if (this._kind === "boss" && s % 8 === 4) Sfx.noise({ dur: 0.06, vol: 0.045, when });
  },
};
