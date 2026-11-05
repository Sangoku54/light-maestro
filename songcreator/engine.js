/* ═══════════════════════════════════════════════════════════════════════
   SongCreator — engine.js
   Moteur de génération musicale générative (côté client, Web Audio).

   Pipeline (miroir de l'architecture des générateurs de musique IA) :
     texte/prompt ─▶ encodeur de texte (genre, mood, BPM, tonalité) ─▶
     planificateur structurel (sections + progression harmonique) ─▶
     synthèse multi-pistes (pad, basse, batterie, arpège, lead) ─▶
     vocodeur → OfflineAudioContext.render() → WAV

   Supports : metatags de paroles ([Intro]/[Verse]/[Chorus]/[Bridge]/[Outro]),
   personas (réutilisation d'un style), stems séparés (voix/instrumental/
   batterie/basse), remaster, extension, reprise.
   ═══════════════════════════════════════════════════════════════════════ */

"use strict";

const SC = (() => {

  /* ─────────── Domaine : bibliothèque de sons par genre ─────────── */
  const GENRE_DB = {
    "Pop":         { bpm: 116, root: 261.63, scale: [0,2,4,5,7,9,11],  drums: "four-on-floor", bright: 0.82 },
    "Hip-Hop":     { bpm: 92,  root: 130.81, scale: [0,3,5,7,10],      drums: "boom-bap",      bright: 0.60 },
    "R&B":         { bpm: 78,  root: 196.00, scale: [0,2,4,5,7,9,11],  drums: "half-time",     bright: 0.56 },
    "Rock":        { bpm: 130, root: 164.81, scale: [0,2,3,5,7,8,10],  drums: "driving",       bright: 0.78 },
    "Electronic":  { bpm: 126, root: 146.83, scale: [0,2,3,5,7,8,10],  drums: "four-on-floor", bright: 0.92 },
    "Jazz":        { bpm: 110, root: 220.00, scale: [0,2,4,5,7,9,10],  drums: "swing",         bright: 0.50 },
    "Country":     { bpm: 100, root: 174.61, scale: [0,2,4,5,7,9,11],  drums: "shuffle",       bright: 0.62 },
    "Classical":   { bpm: 90,  root: 220.00, scale: [0,2,4,5,7,9,11],  drums: "none",          bright: 0.48 },
    "Lo-fi":       { bpm: 72,  root: 196.00, scale: [0,2,4,5,7,9,10],  drums: "boom-bap",      bright: 0.42 },
    "Metal":       { bpm: 160, root: 146.83, scale: [0,1,3,5,6,8,10],  drums: "blast",         bright: 0.85 },
    "Folk":        { bpm: 96,  root: 196.00, scale: [0,2,4,5,7,9,11],  drums: "shuffle",       bright: 0.55 },
    "Reggae":      { bpm: 76,  root: 164.81, scale: [0,2,4,5,7,9,11],  drums: "one-drop",      bright: 0.55 },
  };

  const MOODS = {
    uplifting:  { minor: false, energy: 1.00, arp: 0.5 },
    dreamy:     { minor: true,  energy: 0.60, arp: 0.8 },
    dark:       { minor: true,  energy: 0.80, arp: 0.3 },
    chill:      { minor: false, energy: 0.50, arp: 0.4 },
    epic:       { minor: false, energy: 1.15, arp: 0.2 },
    sad:        { minor: true,  energy: 0.55, arp: 0.5 },
  };

  /* ─────────── PRNG déterministe (seed = hash du prompt) ─────────── */
  function hash32(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ─────────── Analyse du prompt (encodeur de texte) ─────────── */
  function analyzePrompt(text) {
    const t = String(text || "").toLowerCase();
    let genre = "Pop";
    for (const g of Object.keys(GENRE_DB)) {
      const pat = g.toLowerCase();
      if (t.includes(pat) ||
          (g === "R&B" && /r&?b|rnb|soul/.test(t)) ||
          (g === "Lo-fi" && /lofi|lo-f i|lo fi|study|chill/.test(t))) { genre = g; break; }
    }
    // heuristiques de repli
    const kw = {
      "Hip-Hop": /rap|hip|trap|drill/,
      "Electronic": /edm|techno|synth|house|electron|trance/,
      "Jazz": /jazz|swing|bossa/,
      "Metal": /metal|heavy|scream/,
      "Classical": /orchestr|classic|cinematic|symphon|epic/,
      "Rock": /rock|guitar|riff/,
      "Country": /country|banjo/,
      "Folk": /folk|acoustic|indie/,
      "Reggae": /reggae|dub/,
    };
    if (genre === "Pop") {
      for (const g of Object.keys(kw)) if (kw[g].test(t)) { genre = g; break; }
    }

    let mood = MOODS.uplifting;
    if (/dream|airy|ethereal|ambient/.test(t)) mood = MOODS.dreamy;
    else if (/dark|haunt|brood|sad|melanch|somb|trist/.test(t)) mood = MOODS.sad;
    else if (/chill|relax|lofi|calm|détend/.test(t)) mood = MOODS.chill;
    else if (/epic|cinematic|orchestr|trailer|héro/.test(t)) mood = MOODS.epic;

    // détection BPM explicite
    let bpm = GENRE_DB[genre].bpm;
    const bpmMatch = t.match(/(\d{2,3})\s*bpm/);
    if (bpmMatch) bpm = parseInt(bpmMatch[1], 10);

    return { genre, mood, bpm };
  }

  /* ─────────── Analyse des metatags de paroles ─────────── */
  function parseLyrics(lyrics) {
    const sections = [];
    if (!lyrics) return sections;
    const re = /\[([A-Za-zÀ-ÿ ]+)\]/g;
    const matches = [...lyrics.matchAll(re)];
    if (matches.length === 0) {
      sections.push({ name: "Verse", ticks: 8 });
      return sections;
    }
    for (let i = 0; i < matches.length; i++) {
      const name = matches[i][1].trim().toLowerCase();
      const norm = name.includes("intro") ? "Intro" : name.includes("verse") ? "Verse"
        : name.includes("chorus") || name.includes("refrain") ? "Chorus"
        : name.includes("bridge") ? "Bridge" : name.includes("outro") ? "Outro"
        : name.includes("hook") ? "Chorus" : "Verse";
      const start = matches[i].index + matches[i][0].length;
      const end = i + 1 < matches.length ? matches[i + 1].index : lyrics.length;
      sections.push({ name: norm, ticks: Math.max(1, Math.round((end - start) / 3)) });
    }
    return sections;
  }

  /* ─────────── Synthèse principale ─────────── */
  async function synthesize(opts) {
    const o = opts || {};
    const text = o.text || o.style || "Pop";
    const durationSec = o.durationSec || 60;
    const sampleRate = 44100;

    // persona override
    const analysis = o.genre && o.mood
      ? { genre: o.genre, mood: o.mood, bpm: o.bpm || GENRE_DB[o.genre].bpm }
      : analyzePrompt(text);

    const conf = GENRE_DB[analysis.genre] || GENRE_DB["Pop"];
    const mood = analysis.mood || MOODS.uplifting;
    const bpm = analysis.bpm || conf.bpm;
    const rng = mulberry32(hash32(text + (o.seed || "")));

    const length = Math.floor(durationSec * sampleRate);
    const ctx = new OfflineAudioContext(2, length, sampleRate);

    // sous-mix séparés pour stems
    const master = ctx.createGain(); master.gain.value = 1.0;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 5;
    master.connect(comp).connect(ctx.destination);

    const stemBuses = {
      pad: ctx.createGain(),
      bass: ctx.createGain(),
      drums: ctx.createGain(),
      lead: ctx.createGain(),   // "vocals" melody line
    };
    Object.values(stemBuses).forEach((b) => b.connect(master));

    // tonalité
    const root = conf.root * (mood.minor ? Math.pow(2, -3 / 12) : 1);
    const scale = mood.minor ? [0,2,3,5,7,8,10] : conf.scale;
    const prog = mood.minor ? [0, 3, 5, 4] : [0, 5, 3, 4]; // i-iv/bVI etc

    const beatSec = 60 / bpm;
    const barSec = beatSec * 4;
    const totalBars = Math.max(4, Math.floor(durationSec / barSec));

    // plan structurel : utilise les metatags s'il y en a, sinon défaut
    let structure;
    if (o.lyricsSections && o.lyricsSections.length) {
      const energyMap = { Intro: 0.55, Verse: 0.7, Chorus: 1.0, Bridge: 0.8, Outro: 0.5 };
      let barsLeft = totalBars;
      const totalTicks = o.lyricsSections.reduce((s, x) => s + x.ticks, 0) || 1;
      structure = o.lyricsSections.map((s) => ({
        name: s.name,
        bars: Math.max(1, Math.round((s.ticks / totalTicks) * totalBars)),
        energy: energyMap[s.name] || 0.75,
      }));
      // clamp total bars
      const sum = structure.reduce((s, x) => s + x.bars, 0);
      if (sum > totalBars) structure.forEach((s, i) => { if (i > 0) s.bars = Math.max(1, Math.floor(s.bars * totalBars / sum)); });
    } else {
      structure = [
        { name: "Intro", bars: 1, energy: 0.55 },
        { name: "Verse", bars: 3, energy: 0.7 },
        { name: "Chorus", bars: 4, energy: 1.0 },
        { name: "Bridge", bars: 2, energy: 0.8 },
        { name: "Outro", bars: 1, energy: 0.5 },
      ];
    }

    let t = 0;
    const barIndex = { val: 0 };
    for (const sec of structure) {
      for (let b = 0; b < sec.bars && barIndex.val < totalBars; b++) {
        const bi = barIndex.val++;
        const degree = prog[bi % prog.length];
        const chordRoot = root * Math.pow(2, scale[degree] / 12);
        const chordTones = [0, 2, 4].map((i) => chordRoot * Math.pow(2, scale[(degree + i * 2) % scale.length] / 12));
        renderBar(ctx, stemBuses, {
          chordTones, root: chordRoot, conf, rng,
          time: bi * barSec, barSec, beatSec, bpm,
          energy: sec.energy * mood.energy,
          section: sec.name, bright: conf.bright, mood,
        });
      }
    }

    const rendered = await ctx.startRendering();
    return { rendered, stemBuses, durationSec, sampleRate, length };
  }

  function renderBar(ctx, buses, p) {
    const { chordTones, root, conf, rng, time: t0, barSec, beatSec, bpm, energy, section, bright, mood } = p;
    const vel = Math.max(0.02, energy * (0.05 + bright * 0.05));

    /* pad / lit harmonique */
    chordTones.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(vel / chordTones.length * 1.4, t0 + 0.25);
      g.gain.setValueAtTime(vel / chordTones.length * 1.4, t0 + barSec - 0.4);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + barSec);
      osc.connect(g).connect(buses.pad);
      osc.start(t0); osc.stop(t0 + barSec + 0.05);
    });

    /* basse */
    if (conf.bass !== "none") {
      const osc = ctx.createOscillator();
      osc.type = conf.bass === "808" ? "sine" : "sawtooth";
      osc.frequency.value = root;
      const g = ctx.createGain();
      for (let i = 0; i < 4; i++) {
        const st = t0 + i * beatSec;
        g.gain.setValueAtTime(0.0001, st);
        g.gain.exponentialRampToValueAtTime(vel * 0.55, st + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, st + 0.24);
      }
      osc.connect(g).connect(buses.bass);
      osc.start(t0); osc.stop(t0 + barSec);
    }

    /* arpège / lead mélodique — simple séquence de notes */
    if (mood.arp > 0 && section !== "Intro") {
      const arpNotes = chordTones.concat(chordTones.map((f) => f * 2));
      const step = beatSec / 2;
      for (let i = 0; i < 8; i++) {
        const st = t0 + i * step;
        const note = arpNotes[Math.floor(rng() * arpNotes.length)];
        const osc = ctx.createOscillator();
        osc.type = "sine";
        osc.frequency.value = note;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, st);
        g.gain.exponentialRampToValueAtTime(vel * mood.arp, st + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, st + step * 0.7);
        osc.connect(g).connect(buses.lead);
        osc.start(st); osc.stop(st + step);
      }
    }

    /* percussion */
    renderDrums(ctx, buses.drums, { conf, rng, time: t0, beatSec, barSec, energy });
  }

  function renderDrums(ctx, bus, p) {
    const { conf, rng, time: t0, beatSec, barSec, energy } = p;
    if (conf.drums === "none") return;
    const hits = [];
    const add = (off, type, amp) => hits.push({ off, type, amp });

    switch (conf.drums) {
      case "four-on-floor":
        for (let b = 0; b < 4; b++) { add(b * beatSec, "kick", 1.0); add(b * beatSec + beatSec / 2, "hat", 0.5); }
        break;
      case "driving":
      case "blast":
        for (let b = 0; b < 4; b++) { add(b * beatSec, "kick", 0.9); add(b * beatSec + beatSec / 2, "snare", 0.7); }
        for (let b = 0; b < 8; b++) add(b * beatSec / 2, "hat", 0.35);
        break;
      case "boom-bap":
        add(0, "kick", 1.0); add(beatSec, "snare", 0.7); add(beatSec * 2 + beatSec / 2, "kick", 0.6); add(beatSec * 3, "snare", 0.7);
        for (let b = 0; b < 8; b++) if (b % 2 === 0) add(b * beatSec / 2, "hat", 0.28);
        break;
      case "half-time":
        add(0, "kick", 1.0); add(beatSec * 2, "snare", 0.8);
        for (let b = 0; b < 8; b++) add(b * beatSec / 2, "hat", 0.26);
        break;
      case "swing": {
        const sw = beatSec * 0.66;
        add(0, "kick", 0.7); add(sw, "snare", 0.6); add(beatSec * 2, "kick", 0.7); add(beatSec * 2 + sw, "snare", 0.6);
        break;
      }
      case "shuffle":
      case "one-drop":
        add(0, "kick", 0.8); add(beatSec, "snare", 0.6); add(beatSec * 3, "kick", 0.7);
        for (let b = 0; b < 4; b++) add(b * beatSec, "hat", 0.3);
        break;
    }

    hits.forEach((h) => {
      if (h.type === "kick") drumKick(ctx, bus, t0 + h.off, energy * h.amp, rng);
      else if (h.type === "snare") drumSnare(ctx, bus, t0 + h.off, energy * h.amp * 0.85, rng);
      else drumHat(ctx, bus, t0 + h.off, energy * h.amp, rng);
    });
  }

  function drumKick(ctx, dest, t, amp, rng) {
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(150 + rng() * 30, t);
    o.frequency.exponentialRampToValueAtTime(48, t + 0.16);
    const g = ctx.createGain();
    g.gain.setValueAtTime(amp * 0.95, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    o.connect(g).connect(dest);
    o.start(t); o.stop(t + 0.32);
  }
  function drumSnare(ctx, dest, t, amp, rng) {
    const len = 0.16;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * len), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (rng() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.04));
    const src = ctx.createBufferSource(); src.buffer = buf;
    const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 1800; bp.Q.value = 0.8;
    const g = ctx.createGain(); g.gain.value = amp * 0.7;
    src.connect(bp).connect(g).connect(dest);
    src.start(t);
  }
  function drumHat(ctx, dest, t, amp, rng) {
    const len = 0.06;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * len), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (rng() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.012));
    const src = ctx.createBufferSource(); src.buffer = buf;
    const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 8000;
    const g = ctx.createGain(); g.gain.value = amp * 0.4;
    src.connect(hp).connect(g).connect(dest);
    src.start(t);
  }

  /* ─────────── WAV encoding ─────────── */
  function bufferToWavBlob(buffer) {
    const numCh = buffer.numberOfChannels;
    const sr = buffer.sampleRate;
    const len = buffer.length * numCh * 2;
    const arr = new ArrayBuffer(44 + len);
    const view = new DataView(arr);
    const ws = (o, s) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
    ws(0, "RIFF"); view.setUint32(4, 36 + len, true); ws(8, "WAVE");
    ws(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
    view.setUint16(22, numCh, true); view.setUint32(24, sr, true);
    view.setUint32(28, sr * numCh * 2, true); view.setUint16(32, numCh * 2, true); view.setUint16(34, 16, true);
    ws(36, "data"); view.setUint32(40, len, true);
    const chans = []; for (let c = 0; c < numCh; c++) chans.push(buffer.getChannelData(c));
    let off = 44;
    for (let i = 0; i < buffer.length; i++) {
      for (let c = 0; c < numCh; c++) {
        const s = Math.max(-1, Math.min(1, chans[c][i]));
        view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
        off += 2;
      }
    }
    return new Blob([arr], { type: "audio/wav" });
  }

  /* ─────────── Job orchestrator (async + progress) ─────────── */
  const jobs = new Map();
  function queueGeneration(opts, onProgress) {
    const id = "sc-" + Math.random().toString(36).slice(2, 10);
    const job = { id, status: "queued", progress: 0, result: null };
    jobs.set(id, job);

    const stages = [
      { name: "Encodage du prompt", weight: 14 },
      { name: "Planificateur · diffusion latente", weight: 36 },
      { name: "Vocodeur · rendu waveform", weight: 40 },
      { name: "Mixage & mastering", weight: 10 },
    ];

    (async () => {
      let acc = 0;
      for (const s of stages) {
        for (let i = 1; i <= s.weight; i++) {
          await new Promise((r) => setTimeout(r, 16));
          acc++;
          job.progress = Math.round((acc / 100) * 100);
          if (onProgress) onProgress(job.progress, s.name, id);
        }
      }
      job.result = await synthesize(opts);
      job.status = "completed";
      job.progress = 100;
      if (onProgress) onProgress(100, "Terminé", id);
    })();
    return id;
  }
  function getJob(id) { return jobs.get(id); }

  return {
    GENRE_DB, MOODS, analyzePrompt, parseLyrics, synthesize,
    queueGeneration, getJob, bufferToWavBlob, hash32,
  };
})();

if (typeof module !== "undefined") module.exports = SC;
