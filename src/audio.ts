/**
 * Zero-dependency Web Audio API procedural sound synthesizer.
 * Works 100% offline in installed PWA mode with tactile brick snaps,
 * dynamic engine pitch, jet boost roar, and brick-shatter collisions.
 */
class SoundEngine {
  private ctx: AudioContext | null = null;
  private muted = false;
  private engineOsc: OscillatorNode | null = null;
  private engineSub: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;
  private boostNoise: AudioBufferSourceNode | null = null;
  private boostFilter: BiquadFilterNode | null = null;
  private boostGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private drivingActive = false;

  constructor() {
    try {
      this.muted = localStorage.getItem('brickforge_muted') === '1';
    } catch {
      this.muted = false;
    }
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public setMuted(m: boolean): void {
    this.muted = m;
    try {
      localStorage.setItem('brickforge_muted', m ? '1' : '0');
    } catch {
      // ignore storage errors
    }
    if (m && this.engineGain && this.ctx) {
      this.engineGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
    }
    if (m && this.boostGain && this.ctx) {
      this.boostGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
    }
  }

  public toggleMute(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  private ensureContext(): AudioContext | null {
    if (this.muted) return null;
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
      this.noiseBuffer = this.createNoiseBuffer(this.ctx);
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  private createNoiseBuffer(ctx: AudioContext): AudioBuffer {
    const sampleRate = ctx.sampleRate;
    const length = sampleRate * 2;
    const buffer = ctx.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  /** Crisp ABS plastic snap click when placing a brick */
  public playBrickSnap(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(520, now);
    osc.frequency.exponentialRampToValueAtTime(160, now + 0.045);

    gain.gain.setValueAtTime(0.22, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.055);

    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.06);

    // Secondary crisp high click
    const click = ctx.createOscillator();
    const cGain = ctx.createGain();
    click.type = 'sine';
    click.frequency.setValueAtTime(1450, now + 0.01);
    click.frequency.exponentialRampToValueAtTime(880, now + 0.035);
    cGain.gain.setValueAtTime(0.11, now + 0.01);
    cGain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
    click.connect(cGain).connect(ctx.destination);
    click.start(now + 0.01);
    click.stop(now + 0.045);
  }

  public playBrickRemove(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(340, now);
    osc.frequency.exponentialRampToValueAtTime(110, now + 0.08);
    gain.gain.setValueAtTime(0.16, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.085);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.09);
  }

  public playUiTick(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(760, now);
    osc.frequency.exponentialRampToValueAtTime(980, now + 0.03);
    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.035);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.04);
  }

  public playCountdown(go = false): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = go ? 'sawtooth' : 'triangle';
    osc.frequency.setValueAtTime(go ? 880 : 440, now);
    if (go) osc.frequency.exponentialRampToValueAtTime(1174, now + 0.22);
    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + (go ? 0.36 : 0.18));
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + (go ? 0.38 : 0.2));
  }

  /** Satisfying brick crash + scattering plastic clatter */
  public playCrash(intensity = 0.7): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.noiseBuffer) return;
    const now = ctx.currentTime;
    const clamped = Math.min(1.2, Math.max(0.2, intensity));

    // Low thump impact
    const thump = ctx.createOscillator();
    const tGain = ctx.createGain();
    thump.type = 'triangle';
    thump.frequency.setValueAtTime(135, now);
    thump.frequency.exponentialRampToValueAtTime(36, now + 0.16);
    tGain.gain.setValueAtTime(0.32 * clamped, now);
    tGain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    thump.connect(tGain).connect(ctx.destination);
    thump.start(now);
    thump.stop(now + 0.2);

    // Crunch noise burst
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(700 + clamped * 600, now);
    filter.Q.value = 1.2;
    const nGain = ctx.createGain();
    nGain.gain.setValueAtTime(0.24 * clamped, now);
    nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
    src.connect(filter).connect(nGain).connect(ctx.destination);
    src.start(now);
    src.stop(now + 0.24);

    // Plastic brick clatter pings!
    const clatters = Math.min(6, Math.max(2, Math.round(clamped * 5)));
    for (let i = 0; i < clatters; i++) {
      const delay = 0.02 + i * 0.032 + Math.random() * 0.02;
      const ping = ctx.createOscillator();
      const pGain = ctx.createGain();
      ping.type = 'square';
      const freq = 950 + Math.random() * 1400;
      ping.frequency.setValueAtTime(freq, now + delay);
      ping.frequency.exponentialRampToValueAtTime(freq * 0.65, now + delay + 0.03);
      pGain.gain.setValueAtTime(0.045 * clamped, now + delay);
      pGain.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.035);
      ping.connect(pGain).connect(ctx.destination);
      ping.start(now + delay);
      ping.stop(now + delay + 0.04);
    }
  }

  public playPickup(isRepair = false): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const notes = isRepair ? [523, 659, 784] : [659, 880, 1174];
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      const t = now + idx * 0.055;
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.14, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.13);
    });
  }

  public playVictory(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      const t = now + idx * 0.11;
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.18, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.36);
    });
  }

  public startDrivingAudio(): void {
    if (this.drivingActive) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.noiseBuffer) return;

    this.drivingActive = true;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 320;

    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0.0;

    this.engineOsc = ctx.createOscillator();
    this.engineOsc.type = 'sawtooth';
    this.engineOsc.frequency.value = 55;

    this.engineSub = ctx.createOscillator();
    this.engineSub.type = 'triangle';
    this.engineSub.frequency.value = 28;

    this.engineOsc.connect(filter);
    this.engineSub.connect(filter);
    filter.connect(this.engineGain).connect(ctx.destination);

    this.engineOsc.start();
    this.engineSub.start();

    // Boost plasma jet loop
    this.boostNoise = ctx.createBufferSource();
    this.boostNoise.buffer = this.noiseBuffer;
    this.boostNoise.loop = true;

    this.boostFilter = ctx.createBiquadFilter();
    this.boostFilter.type = 'bandpass';
    this.boostFilter.frequency.value = 950;
    this.boostFilter.Q.value = 1.6;

    this.boostGain = ctx.createGain();
    this.boostGain.gain.value = 0;

    this.boostNoise.connect(this.boostFilter).connect(this.boostGain).connect(ctx.destination);
    this.boostNoise.start();
  }

  public updateDrivingAudio(speedNorm: number, throttle: number, boosting: boolean): void {
    if (this.muted || !this.ctx || !this.drivingActive || !this.engineOsc || !this.engineSub || !this.engineGain) {
      return;
    }
    const now = this.ctx.currentTime;
    const rpm = 48 + Math.abs(speedNorm) * 125 + Math.abs(throttle) * 28 + (boosting ? 45 : 0);
    this.engineOsc.frequency.setTargetAtTime(rpm, now, 0.06);
    this.engineSub.frequency.setTargetAtTime(rpm * 0.5, now, 0.06);
    const vol = 0.035 + Math.min(1, Math.abs(speedNorm) + Math.abs(throttle) * 0.4) * 0.065;
    this.engineGain.gain.setTargetAtTime(vol, now, 0.08);

    if (this.boostGain && this.boostFilter) {
      this.boostGain.gain.setTargetAtTime(boosting ? 0.14 : 0.0, now, 0.05);
      this.boostFilter.frequency.setTargetAtTime(boosting ? 1350 + speedNorm * 650 : 600, now, 0.06);
    }
  }

  public stopDrivingAudio(): void {
    this.drivingActive = false;
    try {
      this.engineOsc?.stop();
      this.engineSub?.stop();
      this.boostNoise?.stop();
    } catch {
      // ignore already-stopped
    }
    this.engineOsc = null;
    this.engineSub = null;
    this.engineGain = null;
    this.boostNoise = null;
    this.boostFilter = null;
    this.boostGain = null;
  }
}

export const sound = new SoundEngine();
