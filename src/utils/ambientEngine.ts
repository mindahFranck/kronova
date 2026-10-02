import type { AmbientMix } from '../types';

// Moteur d'ambiances procédurales : tout est synthétisé avec Web Audio,
// sans fichier audio. Chaque piste possède son propre GainNode, branché
// sur un gain maître puis un compresseur qui sert de limiteur de sécurité.

export type AmbientTrackId = keyof AmbientMix;

export const AMBIENT_TRACK_IDS: AmbientTrackId[] = ['rain', 'brown', 'fire', 'cafe'];

const MASTER_GAIN = 0.35;
// Constante de temps des rampes de volume (s)
const RAMP = 0.12;
// Fenêtre de programmation des événements (gouttes, craquements, tintements).
// Large pour rester fluide même quand le navigateur ralentit les timers en arrière-plan.
const LOOKAHEAD = 1.5;
const SCHEDULER_INTERVAL_MS = 250;
const PAUSE_FADE_MS = 600;
// Délai avant de libérer les nœuds d'une piste remise à 0
const RELEASE_DELAY_MS = 800;

// Niveau relatif de chaque piste à 100 %, pour des intensités perçues comparables
const TRACK_LEVEL: Record<AmbientTrackId, number> = {
  rain: 0.9,
  brown: 0.8,
  fire: 1,
  cafe: 1.1,
};

/** Courbe perceptive : 0–100 → gain linéaire 0–1 */
export function volumeToGain(volume: number): number {
  const v = Math.min(100, Math.max(0, Number.isFinite(volume) ? volume : 0)) / 100;
  return v * v;
}

export type NoiseColor = 'white' | 'pink' | 'brown';

/**
 * Génère un bruit bouclable : on produit quelques millisecondes en trop,
 * puis on fond la queue dans le début pour éviter le clic au point de bouclage.
 */
export function createNoiseData(color: NoiseColor, length: number, sampleRate: number): Float32Array {
  const fade = Math.min(Math.floor(sampleRate * 0.05), Math.floor(length / 4));
  const raw = new Float32Array(length + fade);

  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  let last = 0;
  for (let i = 0; i < raw.length; i++) {
    const white = Math.random() * 2 - 1;
    if (color === 'white') {
      raw[i] = white;
    } else if (color === 'pink') {
      // Filtre de Paul Kellet
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.969 * b2 + white * 0.153852;
      b3 = 0.8665 * b3 + white * 0.3104856;
      b4 = 0.55 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.016898;
      raw[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
      b6 = white * 0.115926;
    } else {
      // Intégration avec fuite : évite la dérive continue
      last = (last + 0.02 * white) / 1.02;
      raw[i] = last;
    }
  }

  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) out[i] = raw[i];
  for (let i = 0; i < fade; i++) {
    const t = i / fade;
    out[i] = raw[i] * t + raw[length + i] * (1 - t);
  }

  // Retrait de la composante continue puis normalisation à -1 dBFS
  let mean = 0;
  for (let i = 0; i < length; i++) mean += out[i];
  mean /= length;
  let peak = 0;
  for (let i = 0; i < length; i++) {
    out[i] -= mean;
    peak = Math.max(peak, Math.abs(out[i]));
  }
  const scale = peak > 0 ? 0.89 / peak : 0;
  for (let i = 0; i < length; i++) out[i] *= scale;
  return out;
}

const rand = (min: number, max: number) => min + Math.random() * (max - min);

interface TrackRuntime {
  /** Gain piloté par le volume utilisateur */
  gain: GainNode;
  /** Sources et nœuds permanents à arrêter/déconnecter à la libération */
  nodes: AudioNode[];
  sources: AudioBufferSourceNode[];
  /** Programme les événements ponctuels entre `now` et `horizon` (temps audio) */
  schedule?: (now: number, horizon: number) => void;
  releaseTimer: ReturnType<typeof setTimeout> | null;
}

export class AmbientEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private limiter: DynamicsCompressorNode | null = null;
  private buffers: Partial<Record<NoiseColor, AudioBuffer>> = {};
  private tracks: Partial<Record<AmbientTrackId, TrackRuntime>> = {};
  private mix: AmbientMix = { rain: 0, brown: 0, fire: 0, cafe: 0 };
  private playing = false;
  private disposed = false;
  private scheduler: ReturnType<typeof setInterval> | null = null;
  private suspendTimer: ReturnType<typeof setTimeout> | null = null;

  get isPlaying(): boolean {
    return this.playing;
  }

  setVolumes(mix: AmbientMix): void {
    this.mix = { ...mix };
    if (!this.ctx || !this.playing) return;
    for (const id of AMBIENT_TRACK_IDS) this.applyTrackVolume(id);
  }

  async play(): Promise<void> {
    if (this.disposed) return;
    this.playing = true;
    if (this.suspendTimer) {
      clearTimeout(this.suspendTimer);
      this.suspendTimer = null;
    }

    const ctx = this.ensureContext();
    if (!ctx || !this.master) return;
    if (ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch {
        // Reprise refusée (politique autoplay) : on réessaiera au prochain play()
      }
    }
    // Une pause a pu survenir pendant l'attente
    if (!this.playing || this.disposed) return;

    for (const id of AMBIENT_TRACK_IDS) this.applyTrackVolume(id);
    this.master.gain.cancelScheduledValues(ctx.currentTime);
    this.master.gain.setTargetAtTime(MASTER_GAIN, ctx.currentTime, 0.25);
    this.startScheduler();
  }

  pause(): void {
    this.playing = false;
    this.stopScheduler();
    const ctx = this.ctx;
    if (!ctx || !this.master) return;

    this.master.gain.cancelScheduledValues(ctx.currentTime);
    this.master.gain.setTargetAtTime(0, ctx.currentTime, 0.12);
    if (this.suspendTimer) clearTimeout(this.suspendTimer);
    this.suspendTimer = setTimeout(() => {
      this.suspendTimer = null;
      if (this.playing || !this.ctx) return;
      // Libère toutes les pistes : rien ne tourne pendant la pause
      for (const id of AMBIENT_TRACK_IDS) this.releaseTrack(id);
      void this.ctx.suspend().catch(() => undefined);
    }, PAUSE_FADE_MS);
  }

  dispose(): void {
    this.disposed = true;
    this.playing = false;
    this.stopScheduler();
    if (this.suspendTimer) clearTimeout(this.suspendTimer);
    this.suspendTimer = null;
    for (const id of AMBIENT_TRACK_IDS) this.releaseTrack(id);
    const ctx = this.ctx;
    this.ctx = null;
    this.master = null;
    this.limiter = null;
    this.buffers = {};
    if (ctx) void ctx.close().catch(() => undefined);
  }

  // --- Contexte et ressources ---------------------------------------------

  private ensureContext(): AudioContext | null {
    if (this.ctx) return this.ctx;
    const Ctor =
      typeof window !== 'undefined'
        ? window.AudioContext ||
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        : undefined;
    if (!Ctor) return null;

    const ctx = new Ctor();
    const master = ctx.createGain();
    master.gain.value = 0;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.knee.value = 6;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.25;
    master.connect(limiter);
    limiter.connect(ctx.destination);

    this.ctx = ctx;
    this.master = master;
    this.limiter = limiter;
    return ctx;
  }

  private getBuffer(color: NoiseColor): AudioBuffer {
    const ctx = this.ctx!;
    const cached = this.buffers[color];
    if (cached) return cached;
    const seconds = color === 'white' ? 2 : color === 'pink' ? 3 : 4;
    const length = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    buffer.getChannelData(0).set(createNoiseData(color, length, ctx.sampleRate));
    this.buffers[color] = buffer;
    return buffer;
  }

  private loopSource(color: NoiseColor): AudioBufferSourceNode {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.getBuffer(color);
    src.loop = true;
    return src;
  }

  // --- Gestion des pistes ---------------------------------------------------

  private applyTrackVolume(id: AmbientTrackId): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const target = volumeToGain(this.mix[id]) * TRACK_LEVEL[id];
    let track = this.tracks[id];

    if (target <= 0) {
      if (!track) return;
      track.gain.gain.setTargetAtTime(0, ctx.currentTime, RAMP);
      // Une piste à 0 est entièrement libérée après le fondu
      if (!track.releaseTimer) {
        track.releaseTimer = setTimeout(() => this.releaseTrack(id), RELEASE_DELAY_MS);
      }
      return;
    }

    if (!track) {
      track = this.buildTrack(id);
      this.tracks[id] = track;
    } else if (track.releaseTimer) {
      clearTimeout(track.releaseTimer);
      track.releaseTimer = null;
    }
    track.gain.gain.setTargetAtTime(target, ctx.currentTime, RAMP);
  }

  private releaseTrack(id: AmbientTrackId): void {
    const track = this.tracks[id];
    if (!track) return;
    if (track.releaseTimer) clearTimeout(track.releaseTimer);
    for (const src of track.sources) {
      try {
        src.stop();
      } catch {
        // Source déjà arrêtée
      }
    }
    for (const node of track.nodes) node.disconnect();
    track.gain.disconnect();
    delete this.tracks[id];
  }

  private buildTrack(id: AmbientTrackId): TrackRuntime {
    const ctx = this.ctx!;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(this.master!);
    const track: TrackRuntime = { gain, nodes: [], sources: [], releaseTimer: null };

    if (id === 'rain') this.buildRain(track);
    else if (id === 'brown') this.buildBrown(track);
    else if (id === 'fire') this.buildFire(track);
    else this.buildCafe(track);

    for (const src of track.sources) src.start(0, Math.random() * (src.buffer?.duration ?? 0));
    return track;
  }

  /** Pluie douce : bruit blanc filtré dont le gain fluctue en continu */
  private buildRain(track: TrackRuntime): void {
    const ctx = this.ctx!;
    const src = this.loopSource('white');
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 500;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2400;
    bp.Q.value = 0.5;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 7000;
    const shimmer = ctx.createGain();
    shimmer.gain.value = 0.55;

    src.connect(hp).connect(bp).connect(lp).connect(shimmer).connect(track.gain);
    track.sources.push(src);
    track.nodes.push(hp, bp, lp, shimmer);

    let nextMod = ctx.currentTime;
    let nextDrop = ctx.currentTime + rand(0.05, 0.3);
    track.schedule = (now, horizon) => {
      // Après une interruption, on repart de maintenant plutôt que de rattraper le retard
      nextMod = Math.max(nextMod, now);
      nextDrop = Math.max(nextDrop, now);
      // Fluctuations légères du rideau de pluie
      while (nextMod < horizon) {
        shimmer.gain.setTargetAtTime(rand(0.42, 0.62), nextMod, 0.06);
        nextMod += rand(0.08, 0.22);
      }
      // Quelques gouttes plus nettes, très brèves
      while (nextDrop < horizon) {
        this.noiseBurst(track.gain, nextDrop, {
          duration: rand(0.01, 0.035),
          peak: rand(0.08, 0.22),
          frequency: rand(2500, 5500),
          q: rand(2, 5),
        });
        nextDrop += rand(0.04, 0.25);
      }
    };
  }

  /** Bruit brun : grave, enveloppant, sans événement */
  private buildBrown(track: TrackRuntime): void {
    const ctx = this.ctx!;
    const src = this.loopSource('brown');
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    src.connect(lp).connect(track.gain);
    track.sources.push(src);
    track.nodes.push(lp);
  }

  /** Cheminée : grondement grave lent + craquements aléatoires */
  private buildFire(track: TrackRuntime): void {
    const ctx = this.ctx!;
    const src = this.loopSource('brown');
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 220;
    const rumble = ctx.createGain();
    rumble.gain.value = 0.7;
    src.connect(lp).connect(rumble).connect(track.gain);
    track.sources.push(src);
    track.nodes.push(lp, rumble);

    let nextSwell = ctx.currentTime;
    let nextCrackle = ctx.currentTime + rand(0.1, 0.4);
    track.schedule = (now, horizon) => {
      nextSwell = Math.max(nextSwell, now);
      nextCrackle = Math.max(nextCrackle, now);
      while (nextSwell < horizon) {
        rumble.gain.setTargetAtTime(rand(0.5, 0.85), nextSwell, 0.4);
        nextSwell += rand(0.6, 1.4);
      }
      while (nextCrackle < horizon) {
        // Les craquements arrivent parfois en petites salves
        const burst = Math.random() < 0.25 ? Math.floor(rand(2, 5)) : 1;
        let t = nextCrackle;
        for (let i = 0; i < burst; i++) {
          this.noiseBurst(track.gain, t, {
            duration: rand(0.004, 0.02),
            peak: rand(0.25, 0.7),
            frequency: rand(1200, 4500),
            q: rand(0.8, 3),
          });
          t += rand(0.015, 0.07);
        }
        nextCrackle += rand(0.08, 0.6);
      }
    };
  }

  /** Café calme : brouhaha lointain (bruit rose filtré) + rares tintements de tasse */
  private buildCafe(track: TrackRuntime): void {
    const ctx = this.ctx!;
    const src = this.loopSource('pink');
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 450;
    bp.Q.value = 0.6;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1600;
    const murmur = ctx.createGain();
    murmur.gain.value = 0.8;
    src.connect(bp).connect(lp).connect(murmur).connect(track.gain);
    track.sources.push(src);
    track.nodes.push(bp, lp, murmur);

    let nextSwell = ctx.currentTime;
    let nextClink = ctx.currentTime + rand(3, 8);
    track.schedule = (now, horizon) => {
      nextSwell = Math.max(nextSwell, now);
      nextClink = Math.max(nextClink, now);
      // Ondulation lente des conversations
      while (nextSwell < horizon) {
        murmur.gain.setTargetAtTime(rand(0.65, 0.95), nextSwell, 0.8);
        nextSwell += rand(1.5, 3.5);
      }
      while (nextClink < horizon) {
        this.clink(track.gain, nextClink);
        nextClink += rand(5, 14);
      }
    };
  }

  // --- Événements ponctuels -------------------------------------------------

  private noiseBurst(
    dest: AudioNode,
    when: number,
    opts: { duration: number; peak: number; frequency: number; q: number }
  ): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.getBuffer('white');
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = opts.frequency;
    filter.Q.value = opts.q;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, when);
    env.gain.linearRampToValueAtTime(opts.peak, when + 0.001);
    env.gain.exponentialRampToValueAtTime(0.0001, when + opts.duration);

    src.connect(filter).connect(env).connect(dest);
    const offset = Math.random() * (src.buffer.duration - 0.1);
    src.start(when, offset, opts.duration + 0.01);
    src.onended = () => {
      src.disconnect();
      filter.disconnect();
      env.disconnect();
    };
  }

  private clink(dest: AudioNode, when: number): void {
    const ctx = this.ctx!;
    const base = rand(2200, 3400);
    const decay = rand(0.35, 0.7);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, when);
    env.gain.linearRampToValueAtTime(rand(0.012, 0.025), when + 0.002);
    env.gain.exponentialRampToValueAtTime(0.0001, when + decay);
    env.connect(dest);

    // Fondamentale + partiel inharmonique, typique de la céramique
    const partials = [base, base * 2.76];
    let remaining = partials.length;
    for (const [i, freq] of partials.entries()) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const level = ctx.createGain();
      level.gain.value = i === 0 ? 1 : 0.35;
      osc.connect(level).connect(env);
      osc.start(when);
      osc.stop(when + decay + 0.05);
      osc.onended = () => {
        osc.disconnect();
        level.disconnect();
        remaining -= 1;
        if (remaining === 0) env.disconnect();
      };
    }
  }

  // --- Programmation --------------------------------------------------------

  private startScheduler(): void {
    if (this.scheduler) return;
    const tick = () => {
      const ctx = this.ctx;
      if (!ctx || !this.playing) return;
      const horizon = ctx.currentTime + LOOKAHEAD;
      for (const id of AMBIENT_TRACK_IDS) {
        const track = this.tracks[id];
        // Pas d'événements pour une piste en cours de libération
        if (track?.schedule && !track.releaseTimer) track.schedule(ctx.currentTime, horizon);
      }
    };
    tick();
    this.scheduler = setInterval(tick, SCHEDULER_INTERVAL_MS);
  }

  private stopScheduler(): void {
    if (this.scheduler) clearInterval(this.scheduler);
    this.scheduler = null;
  }
}
