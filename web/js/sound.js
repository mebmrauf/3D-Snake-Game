// Small synthesized sound effects, so the game needs no audio files.
export class Sound {
  constructor() {
    this.context = null;
    this.muted = false;
  }

  // Browsers only allow audio after a user gesture, so this runs on the first tap or key press
  unlock() {
    if (!this.context) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) {
        return;
      }
      this.context = new AudioContext();
    }
    if (this.context.state === "suspended") {
      this.context.resume();
    }
  }

  tone(frequency, duration, { type = "sine", volume = 0.18, delay = 0, slideTo = null } = {}) {
    const start = this.context.currentTime + delay;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    if (slideTo) {
      oscillator.frequency.exponentialRampToValueAtTime(slideTo, start + duration);
    }
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain).connect(this.context.destination);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  }

  noise(duration, volume = 0.3) {
    const length = Math.floor(this.context.sampleRate * duration);
    const buffer = this.context.createBuffer(1, length, this.context.sampleRate);
    const samples = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      samples[i] = (Math.random() * 2 - 1) * (1 - i / length);
    }
    const source = this.context.createBufferSource();
    const gain = this.context.createGain();
    gain.gain.value = volume;
    source.buffer = buffer;
    source.connect(gain).connect(this.context.destination);
    source.start();
  }

  play(name) {
    if (this.muted || !this.context || this.context.state !== "running") {
      return;
    }
    switch (name) {
      case "eat":
        this.tone(520, 0.12, { type: "triangle", slideTo: 880 });
        break;
      case "star":
        [660, 880, 1100, 1320].forEach((frequency, i) => this.tone(frequency, 0.14, { type: "triangle", delay: i * 0.07 }));
        break;
      case "slow":
        this.tone(900, 0.5, { type: "sine", slideTo: 300 });
        break;
      case "shrink":
        [880, 660, 440].forEach((frequency, i) => this.tone(frequency, 0.08, { type: "square", volume: 0.08, delay: i * 0.06 }));
        break;
      case "ghost":
        this.tone(500, 0.6, { type: "sine", volume: 0.12, slideTo: 700 });
        this.tone(505, 0.6, { type: "sine", volume: 0.12, slideTo: 690 });
        break;
      case "ghostSave":
        this.noise(0.25, 0.2);
        this.tone(300, 0.2, { type: "triangle", slideTo: 900 });
        break;
      case "levelUp":
        [523, 659, 784, 1047, 1319].forEach((frequency, i) => this.tone(frequency, 0.16, { type: "triangle", delay: i * 0.08 }));
        break;
      case "tick":
        this.tone(440, 0.1, { type: "square", volume: 0.08 });
        break;
      case "go":
        this.tone(880, 0.2, { type: "square", volume: 0.1 });
        break;
      case "obstacles":
        this.tone(160, 0.35, { type: "sawtooth", volume: 0.07, slideTo: 260 });
        break;
      case "bombs":
        this.tone(300, 0.12, { type: "square", volume: 0.07 });
        this.tone(300, 0.12, { type: "square", volume: 0.07, delay: 0.18 });
        break;
      case "gameOver":
        this.noise(0.4, 0.25);
        this.tone(220, 0.5, { type: "sawtooth", volume: 0.12, slideTo: 60 });
        break;
      case "win":
        [523, 659, 784, 1047].forEach((frequency, i) => this.tone(frequency, 0.25, { type: "triangle", delay: i * 0.12 }));
        break;
      case "click":
        this.tone(700, 0.05, { type: "triangle", volume: 0.08 });
        break;
    }
  }
}
