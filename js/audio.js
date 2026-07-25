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
