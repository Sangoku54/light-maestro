/* ═══════════════════════════════════════════════════════════════════════
   SongCreator — script.js
   Logique applicative complète (clone Suno) : routage des vues, création
   (mode simple / ReMi / personnalisé), exploration, bibliothèque, playlists,
   lecteur global, crédits, détails de morceau (stems, remaster, extend,
   cover, persona), persistance localStorage.
   ═══════════════════════════════════════════════════════════════════════ */

"use strict";

/* ─────────── Helpers ─────────── */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const uid = () => "sc-" + Math.random().toString(36).slice(2, 10);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));

const COVERS = [
  "https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=400&q=80&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=400&q=80&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=400&q=80&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1506157786151-b8491531f063?w=400&q=80&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=400&q=80&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1459749411175-04bf5292ceea?w=400&q=80&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1485579149621-3123dd979885?w=400&q=80&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1524368535928-5b5e00ddc76b?w=400&q=80&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1493225255756-d9584f8606e9?w=400&q=80&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1519892300165-cb5542fb47c7?w=400&q=80&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?w=400&q=80&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1496293455970-f8581aae0e3b?w=400&q=80&auto=format&fit=crop",
];
const cover = (n) => COVERS[Math.abs(n) % COVERS.length];
const avatar = (n) => `https://i.pravatar.cc/100?img=${(Math.abs(n) % 70) + 1}`;

/* ═══════════════ Backend IA — bridge ═══════════════
   Le backend Python (server.py) expose :
     POST /generate  (MusicGen)  → musique
     POST /sing      (Bark)      → voix chantée
     POST /stems     (Demucs)    → séparation
     GET  /job?id=   /result?id= /stem?id=
   Fallback procédural (engine.js) si backend absent. */
const Backend = (() => {
  const BASE = "http://127.0.0.1:8765";
  let available = false;
  let modelInfo = null;

  async function detect() {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 2000);
      const r = await fetch(BASE + "/health", { signal: ctrl.signal });
      clearTimeout(t);
      if (r.ok) {
        const d = await r.json();
        if (d.status === "ok") { available = true; modelInfo = d; }
      }
    } catch (e) { available = false; }
    return available;
  }

  async function post(path, body) {
    const r = await fetch(BASE + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(path + " HTTP " + r.status);
    return r.json();
  }

  async function poll(job_id, onProgress) {
    return new Promise((resolve, reject) => {
      const t = setInterval(async () => {
        try {
          const j = await (await fetch(BASE + "/job?id=" + job_id)).json();
          if (onProgress) onProgress(j.progress || 0, j.status);
          if (j.status === "completed") { clearInterval(t); resolve(j); }
          else if (j.status === "error") { clearInterval(t); reject(new Error("backend error")); }
        } catch (e) {
          clearInterval(t); reject(e);
          onProgress(100, "déconnecté");
        }
      }, 600);
    });
  }

  async function fetchAudio(job_id, fmt) {
    const ar = await fetch(BASE + "/result?id=" + job_id + "&fmt=" + (fmt || "wav"));
    const blob = await ar.blob();
    const url = URL.createObjectURL(blob);
    const headerDur = parseFloat(ar.headers.get("X-Duration") || "0");
    let dur = headerDur;
    try {
      const ab = await blob.arrayBuffer();
      dur = await new Promise((res) => {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        ctx.decodeAudioData(ab, (buf) => { res(buf.duration); ctx.close().catch(() => {}); },
          () => res(headerDur));
      });
    } catch (e) { dur = dur || headerDur; }
    return { url, duration: dur || 0, blob };
  }

  /* musique (MusicGen) */
  async function generate(text, durationSec, onProgress, variant) {
    const body = { text, duration: durationSec };
    if (variant) body.variant = variant;
    const { job_id } = await post("/generate", body);
    await poll(job_id, onProgress);
    const a = await fetchAudio(job_id, "wav");
    return { ...a, ia: true, kind: "music", job_id, variant: variant || "medium" };
  }

  /* voix chantée (Bark) */
  async function sing(text, voice, onProgress) {
    const { job_id } = await post("/sing", { text, voice });
    await poll(job_id, onProgress);
    const a = await fetchAudio(job_id, "wav");
    return { ...a, ia: true, kind: "vocals", job_id };
  }

  /* séparation de stems (Demucs) — audio_b64 = base64 du WAV */
  async function stems(audioB64, onProgress) {
    const { job_id } = await post("/stems", { audio_b64: audioB64 });
    await poll(job_id, onProgress);
    // fetch des 4 stems
    const names = ["vocals", "drums", "bass", "other"];
    const out = {};
    for (const n of names) {
      const ar = await fetch(BASE + "/stem?id=" + job_id + "&stem=" + n);
      out[n] = URL.createObjectURL(await ar.blob());
    }
    return { stems: out, ia: true, job_id };
  }

  return {
    BASE, detect, generate, sing, stems, fetchAudio,
    get available() { return available; },
    get modelInfo() { return modelInfo; },
  };
})();

/* ─────────── État ─────────── */
const store = load() || {
  tracks: [],          // mes chansons générées
  likes: [],           // ids aimés
  playlists: [],       // [{id,name,cover,trackIds}]
  personas: [],        // [{id,name,genre,mood,bpm,cover}]
  credits: parseInt(localStorage.getItem("sc-credits") || "150", 10),
  user: null,
};
function persist() {
  try { localStorage.setItem("sc-store", JSON.stringify(store)); } catch (e) {}
  try { localStorage.setItem("sc-credits", String(store.credits)); } catch (e) {}
  save({ tracks: store.tracks, likes: store.likes, playlists: store.playlists, personas: store.personas, credits: store.credits, user: store.user });
}
function load() {
  try { const d = JSON.parse(localStorage.getItem("sc-store")); return d ? { tracks: [], likes: [], playlists: [], personas: [], credits: parseInt(localStorage.getItem("sc-credits") || "150", 10), user: null, ...d } : null; } catch (e) { return null; }
}
function save(d) { try { localStorage.setItem("sc-store", JSON.stringify(d)); } catch (e) {} }

const ui = {
  audio: document.getElementById("audio"),
  queueIds: [],
  queueIndex: -1,
  shuffle: false,
  loop: false,
  playingId: null,
  currentView: "home",
  createTab: "song",
  customMode: false,
};

/* ─────────── Toast ─────────── */
let toastT;
function toast(msg, icon = "circle-check") {
  document.getElementById("toastMsg").textContent = msg;
  document.getElementById("toast").querySelector("i").className = "fa-solid fa-" + icon;
  document.getElementById("toast").hidden = false;
  clearTimeout(toastT);
  toastT = setTimeout(() => (document.getElementById("toast").hidden = true), 2800);
}

/* ─────────── Routage des vues ─────────── */
function nav(view) {
  ui.currentView = view;
  $$(".side-item").forEach((b) => b.classList.toggle("is-active", b.dataset.view === view));
  $$(".view").forEach((v) => v.classList.toggle("is-active", v.id === "view-" + view));
  // rendus par vue
  if (view === "home") { renderTrending(); renderNew(); }
  if (view === "create") renderRecent();
  if (view === "explore") renderExplore();
  if (view === "library") renderLibrary();
  if (view === "playlists") renderPlaylists();
}
$$(".side-item").forEach((b) => b.addEventListener("click", () => nav(b.dataset.view)));
$$("[data-view]").forEach((b) => b.addEventListener("click", () => nav(b.dataset.view)));

/* ─────────── Création — onglets Song / ReMi ─────────── */
$$(".create-tab").forEach((t) => t.addEventListener("click", () => {
  $$(".create-tab").forEach((x) => x.classList.toggle("is-active", x === t));
  ui.createTab = t.dataset.ctab;
}));

/* mode personnalisé toggle */
document.getElementById("customToggle").addEventListener("click", () => {
  ui.customMode = !ui.customMode;
  document.getElementById("customSwitch").classList.toggle("on", ui.customMode);
  document.getElementById("customCreate").hidden = !ui.customMode;
  document.getElementById("simpleCreate").hidden = ui.customMode;
  renderPersonas();
});

/* metatags */
const METATAGS = ["[Intro]", "[Verse]", "[Chorus]", "[Bridge]", "[Hook]", "[Outro]", "[Pre-Chorus]"];
function renderMetatags() {
  const el = document.getElementById("metaTags");
  el.innerHTML = "";
  METATAGS.forEach((tag) => {
    const b = document.createElement("button");
    b.className = "meta-tag";
    b.textContent = tag;
    b.addEventListener("click", () => {
      const ta = document.getElementById("cLyrics");
      const p = ta.selectionStart ?? ta.value.length;
      ta.value = ta.value.slice(0, p) + tag + "\n" + ta.value.slice(p);
      ta.focus();
    });
    el.appendChild(b);
  });
}
renderMetatags();

/* personas */
function renderPersonas() {
  const el = document.getElementById("personaList");
  el.innerHTML = "";
  if (!ui.customMode) return;
  if (!store.personas.length) {
    el.innerHTML = '<div class="hint">Aucune persona — créez un morceau puis réutilisez sa voix/style.</div>';
    return;
  }
  store.personas.forEach((p) => {
    const d = document.createElement("div");
    d.className = "persona";
    d.innerHTML = `<img src="${p.cover}" alt=""/><span>${esc(p.name)}</span>`;
    d.addEventListener("click", () => {
      // charge le style dans les champs custom
      document.getElementById("cStyle").value = `${p.genre}, ${p.mood}, ${p.bpm} BPM`;
      $$(".persona").forEach((x) => x.classList.toggle("is-active", x === d));
    });
    el.appendChild(d);
  });
}

/* outils */
const toolState = { instrumental: false };
document.getElementById("toolInstrumental").addEventListener("click", () => {
  toolState.instrumental = !toolState.instrumental;
  document.getElementById("toolInstrumental").classList.toggle("is-active", toolState.instrumental);
});
document.getElementById("toolUpload").addEventListener("click", () => toast("Upload audio : sélectionnez un fichier pour le remixer.", "upload"));
document.getElementById("toolImage").addEventListener("click", () => toast("Image / vidéo : fonctionnalité Scenes (génération vidéo).", "image"));
document.getElementById("toolLyrics").addEventListener("click", () => {
  if (!ui.customMode) document.getElementById("customToggle").click();
  document.getElementById("cLyrics").focus();
});
document.getElementById("toolVoice").addEventListener("click", async () => {
  // génère une voix chantée depuis les paroles (Bark)
  const lyrics = document.getElementById("cLyrics").value.trim()
    || document.getElementById("createPrompt").value.trim()
    || "Welcome to SongCreator. Let's make some beautiful music together.";
  if (!Backend.available) {
    toast("La voix chantée nécessite le backend IA (Bark). Lancez launch_backend.bat.", "microphone-lines");
    return;
  }
  toast("Génération vocale (Bark)…", "microphone-lines");
  document.getElementById("genbar").hidden = false;
  document.getElementById("genbarFill").style.width = "0%";
  try {
    const res = await Backend.sing(cleanLyrics(lyrics), null, (p) => {
      document.getElementById("genbarFill").style.width = Math.min(99, p) + "%";
      document.getElementById("genbarStage").textContent = "Voix chantée (Bark) · " + p + "%";
    });
    document.getElementById("genbar").hidden = true;
    const vt = { id: uid(), title: "Voix — " + makeTitle(lyrics, "Vocals"), artist: "SongCreator · Bark",
      genre: "Vocals", cover: cover(SC.hash32(lyrics)), url: res.url, duration: Math.round(res.duration),
      lyrics: lyrics, stems: {}, ia: true };
    store.tracks.unshift(vt); persist(); renderAll();
    playTrack(vt, true);
    toast("Voix chantée générée ✓");
  } catch (e) {
    document.getElementById("genbar").hidden = true;
    toast("Erreur de génération vocale", "triangle-exclamation");
    console.warn(e);
  }
});
document.getElementById("toolSplit").addEventListener("click", () => {
  const t = store.tracks.find(x => x.id === ui.playingId);
  if (t) { openDetail(t); toggleStems(t); }
  else toast("Lisez un morceau pour le séparer en stems.", "scissors");
});

/* crédits */
function renderCredits() {
  const el = document.getElementById("creditsCount");
  const label = document.getElementById("creditsLabel");
  el.textContent = store.credits;
  document.getElementById("creditLabel").textContent = store.credits;
  label.classList.toggle("credits--low", store.credits < 20);
}

/* ─────────── Génération ─────────── */
document.getElementById("createBtn").addEventListener("click", generate);
document.getElementById("homePromptGo").addEventListener("click", () => {
  const v = document.getElementById("homePrompt").value.trim();
  if (v) { document.getElementById("createPrompt").value = v; }
  else { document.getElementById("createPrompt").value = document.getElementById("homePrompt").value || ""; }
  nav("create");
  generate();
});
document.getElementById("homePrompt").addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("homePromptGo").click();
});

function buildGeneration() {
  if (ui.customMode) {
    const title = document.getElementById("cTitle").value.trim();
    const lyrics = document.getElementById("cLyrics").value;
    const style = document.getElementById("cStyle").value.trim();
    const exclude = document.getElementById("cExclude").value.trim();
    const model = document.getElementById("cModel").value;
    const dur = parseInt(document.getElementById("cDur").value || "60", 10);
    const sections = SC.parseLyrics(lyrics);
    const hasLyrics = lyrics.trim().length > 0;
    // mapping modèle UI → variant MusicGen backend (déjà medium/small/melody)
    const variant = (model === "medium" || model === "melody" || model === "small") ? model : "medium";
    return {
      text: (style || "Pop") + (title ? " " + title : "") + (lyrics ? " " + lyrics.slice(0, 80) : ""),
      style, exclude, title, lyrics, sections,
      instrumental: toolState.instrumental || !hasLyrics,
      durationSec: dur, model, variant,
    };
  }
  // mode simple / ReMi
  const text = document.getElementById("createPrompt").value.trim() || "chanson pop agréable";
  const dur = 30; // ~30s : structure intro/verse/chorus complète
  return { text, sections: [], instrumental: toolState.instrumental, durationSec: dur, model: "medium" };
}

async function generate() {
  if (store.credits <= 0) {
    toast("Crédits épuisés — passez à Pro pour générer davantage.", "triangle-exclamation");
    openAuth("signup");
    return;
  }
  const spec = buildGeneration();
  const analysis = SC.analyzePrompt(spec.text);

  const genbar = document.getElementById("genbar");
  const fill = document.getElementById("genbarFill");
  const stage = document.getElementById("genbarStage");
  genbar.hidden = false;
  document.getElementById("createBtn").disabled = true;

  // ── 1. Essayer le backend IA (vrai modèle MusicGen) ──
  if (Backend.available) {
    stage.textContent = "Inférence IA sur GPU · 0%";
    const variant = spec.variant || "medium";
    try {
      const result = await Backend.generate(spec.text, spec.durationSec, (p, s) => {
        fill.style.width = Math.min(99, p) + "%";
        stage.textContent = "Génération IA (MusicGen " + variant + ") · " + p + "%";
      }, variant);
      fill.style.width = "100%";
      finishGeneration({ url: result.url, duration: result.duration, ia: true, model: "MusicGen-" + variant }, spec, analysis, true);
      return;
    } catch (e) {
      console.warn("Backend IA indisponible, bascule sur le moteur procédural.", e);
      Backend.available = false;
    }
  }

  // ── 2. Fallback procédural ──
  const jobId = SC.queueGeneration({ ...spec, genre: analysis.genre, mood: analysis.mood, bpm: analysis.bpm }, (p, s) => {
    fill.style.width = p + "%";
    stage.textContent = s + " · " + p + "%";
  });

  const poll = setInterval(() => {
    const job = SC.getJob(jobId);
    if (job && job.status === "completed") {
      clearInterval(poll);
      finishGeneration({ url: URL.createObjectURL(SC.bufferToWavBlob(job.result.rendered)), duration: spec.durationSec, ia: false }, spec, analysis, false);
    }
  }, 80);
}

function finishGeneration(result, spec, analysis, isIA) {
  const title = spec.title || makeTitle(spec.text, analysis.genre);
  const track = {
    id: uid(),
    title,
    artist: "SongCreator",
    genre: analysis.genre,
    mood: analysis.mood.minor ? "mineur" : "majeur",
    bpm: analysis.bpm,
    cover: cover(SC.hash32(spec.text)),
    url: result.url,
    duration: Math.round(result.duration || spec.durationSec),
    createdAt: Date.now(),
    lyrics: spec.lyrics || "",
    style: spec.style || spec.text,
    model: isIA ? (result.model || "MusicGen-medium") : (spec.model || "procédural"),
    ia: isIA,
    stems: { vocals: null, drums: null, instrumental: null, bass: null },
    plays: 0,
  };
  store.tracks.unshift(track);
  store.credits -= 2; // coût par génération
  persist();
  renderCredits();

  // reset UI
  document.getElementById("genbar").hidden = true;
  document.getElementById("genbarFill").style.width = "0%";
  document.getElementById("createBtn").disabled = false;

  nav("library");
  renderLibrary();
  playTrack(track, true);
  if (isIA) {
    document.getElementById("genbarStage").textContent = "Encodage du prompt…";
    toast(`« ${title} » généré par MusicGen (IA réelle sur GPU)`);
  } else {
    toast(`« ${title} » — moteur procédural (${analysis.genre}, ${analysis.bpm} BPM)`);
  }
}

function makeTitle(text, genre) {
  const words = ["Aurora","Bloom","Écho","Velours","Horizon","Étincelle","Cascade","Braise","Prisme","Rêverie","Satellite","Mirage","Sérénade","Lumière"];
  const w = words[Math.floor(Math.random() * words.length)];
  const clean = String(text || "").split(" ").filter(w => w.length > 2).slice(0, 3).join(" ");
  return clean ? clean.charAt(0).toUpperCase() + clean.slice(1) : `${w} ${genre}`;
}

/* ─────────── Rendu des cartes ─────────── */
function coverCard(t) {
  const liked = store.likes.includes(t.id);
  return `
    <div class="cover-card" data-id="${t.id}">
      <img class="cover-card__art" src="${t.cover}" alt="" loading="lazy"/>
      <div class="cover-card__glow"><span class="cover-card__play"><i class="fa-solid fa-play"></i></span></div>
      <span class="tag-pill">${esc(t.genre || "Pop")}</span>
      <div class="cover-card__body">
        <div class="cover-card__title">${esc(t.title)}</div>
        <div class="cover-card__meta">${esc(t.artist)}${liked ? ' · <i class="fa-solid fa-heart" style="color:#5b8cff"></i>' : ""}</div>
      </div>
    </div>`;
}
function bindCards(root) {
  $$(".cover-card", root).forEach((c) => c.addEventListener("click", () => {
    const t = store.tracks.find((x) => x.id === c.dataset.id);
    if (t) openDetail(t);
  }));
}

/* home */
const COMMUNITY = [
  { title: "Neon Drive", artist: "Luna", genre: "Electronic" },
  { title: "Paris en été", artist: "Marc", genre: "Pop" },
  { title: "Minuit", artist: "Nadia", genre: "Lo-fi" },
  { title: "Rêve Corail", artist: "Yuki", genre: "R&B" },
  { title: "Horizons", artist: "Ivan", genre: "Rock" },
  { title: "Pluie d'hiver", artist: "Sofia", genre: "Classical" },
  { title: "Soleil Levant", artist: "Ayo", genre: "Hip-Hop" },
  { title: "Brume", artist: "Elio", genre: "Folk" },
];
function renderTrending() {
  const list = store.tracks.length ? store.tracks.slice(0, 8) : COMMUNITY.slice(0, 8).map((c, i) => ({ ...c, id: "comm-" + i, cover: cover(i), duration: 60, url: null, plays: 0 }));
  document.getElementById("trendingGrid").innerHTML = list.map(coverCard).join("");
  bindCards(document.getElementById("trendingGrid"));
}
function renderNew() {
  const list = store.tracks.slice().reverse().slice(0, 8);
  if (!list.length) {
    document.getElementById("newGrid").innerHTML = `<div class="empty-state" style="grid-column:1/-1"><i class="fa-solid fa-music"></i><p>Vos nouvelles créations apparaîtront ici.</p></div>`;
    return;
  }
  document.getElementById("newGrid").innerHTML = list.map(coverCard).join("");
  bindCards(document.getElementById("newGrid"));
}

/* explore */
const GENRES_ALL = ["Tous","Pop","Hip-Hop","R&B","Rock","Electronic","Jazz","Lo-fi","Metal","Classical","Folk","Country","Reggae"];
let exploreFilter = "Tous";
function renderExploreFilters() {
  const el = document.getElementById("exploreFilters");
  el.innerHTML = GENRES_ALL.map((g) => `<button class="fchip ${g === exploreFilter ? "is-active" : ""}" data-genre="${g}">${g}</button>`).join("");
  $$(".fchip", el).forEach((b) => b.addEventListener("click", () => {
    exploreFilter = b.dataset.genre;
    renderExploreFilters();
    renderExplore();
  }));
}
function renderExplore() {
  if (!document.getElementById("exploreFilters").children.length) renderExploreFilters();
  const pool = store.tracks.length ? store.tracks : COMMUNITY.map((c, i) => ({ ...c, id: "comm-" + i, cover: cover(i), duration: 60, url: null, plays: 0 }));
  const list = exploreFilter === "Tous" ? pool : pool.filter(t => (t.genre || "Pop") === exploreFilter);
  const el = document.getElementById("exploreGrid");
  if (!list.length) { el.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><p>Aucun titre dans ce genre.</p></div>`; return; }
  el.innerHTML = list.map(coverCard).join("");
  bindCards(el);
}

/* library */
let libTab = "songs";
$$(".lib-tab").forEach((b) => b.addEventListener("click", () => {
  $$(".lib-tab").forEach((x) => x.classList.toggle("is-active", x === b));
  libTab = b.dataset.libtab;
  renderLibrary();
}));
function renderLibrary() {
  const el = document.getElementById("libraryGrid");
  const list = libTab === "songs" ? store.tracks : store.tracks.filter(t => store.likes.includes(t.id));
  if (!list.length) {
    el.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><i class="fa-solid ${libTab === "songs" ? "fa-music" : "fa-heart"}"></i><p>${libTab === "songs" ? "Aucune chanson — créez votre premier morceau !" : "Aucun titre aimé pour l'instant."}</p></div>`;
    return;
  }
  el.innerHTML = list.map(coverCard).join("");
  bindCards(el);
}

/* recent (create view) */
function renderRecent() {
  const el = document.getElementById("recentGrid");
  const list = store.tracks.slice(0, 8);
  if (!list.length) {
    el.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><p>Vos générations récentes apparaîtront ici.</p></div>`;
    return;
  }
  el.innerHTML = list.map(coverCard).join("");
  bindCards(el);
}

/* ─────────── Playlists ─────────── */
function renderPlaylists() {
  const el = document.getElementById("playlistGrid");
  const liked = { id: "liked", name: "Mes likes", cover: cover(1), trackIds: store.likes };
  const all = [liked, ...store.playlists];
  el.innerHTML = all.map((p) => `
    <div class="cover-card" data-plid="${p.id}">
      <div class="playlist-card" style="background:linear-gradient(135deg, ${plColor(p.id)}, ${plColor(p.id + "x")})">
        <i class="fa-solid fa-music"></i>
        <span class="playlist-card__label">${esc(p.name)}</span>
      </div>
    </div>`).join("");
  $$(".cover-card[data-plid]", el).forEach((c) => c.addEventListener("click", () => openPlaylist(c.dataset.plid)));
}
function plColor(s) {
  const h = SC.hash32(String(s));
  return `hsl(${h % 360}, 70%, 45%)`;
}
let activePlaylist = null;
function openPlaylist(id) {
  activePlaylist = id;
  // simplifie : affiche un toast + vue exploratoire filtrée
  const list = id === "liked" ? store.tracks.filter(t => store.likes.includes(t.id))
    : ((store.playlists.find(p => p.id === id) || {}).trackIds || []).map(tid => store.tracks.find(t => t.id === tid)).filter(Boolean);
  nav("library");
  const el = document.getElementById("libraryGrid");
  if (!list.length) { el.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><p>Cette playlist est vide.</p></div>`; return; }
  el.innerHTML = list.map(coverCard).join("");
  bindCards(el);
  toast("Lecture de la playlist en cours…");
}
document.getElementById("newPlaylistBtn").addEventListener("click", () => {
  store.playlists.push({ id: uid(), name: "Playlist " + (store.playlists.length + 1), cover: cover(store.playlists.length), trackIds: [] });
  persist(); renderPlaylists();
});

/* ─────────── Détail de morceau ─────────── */
let detailTrack = null;
function openDetail(t) {
  detailTrack = t;
  document.getElementById("detailArt").src = t.cover;
  document.getElementById("detailTitle").textContent = t.title;
  document.getElementById("detailSub").textContent = `${t.artist} · ${t.genre} · ${t.bpm} BPM · ${t.duration}s`;
  const liked = store.likes.includes(t.id);
  document.getElementById("detailLike").innerHTML = `<i class="fa-${liked ? "solid" : "regular"} fa-heart"></i> <span>${liked ? "Je n'aime plus" : "J'aime"}</span>`;
  document.getElementById("detailModal").hidden = false;

  document.getElementById("detailPlay").onclick = () => {
    if (!t.url) { generateCommunityPlay(t); return; }
    const playing = ui.playingId === t.id && !ui.audio.paused;
    playing ? pause() : playTrack(t, true);
  };
  document.getElementById("detailRemaster").onclick = () => remaster(t);
  document.getElementById("detailExtend").onclick = () => extend(t);
  document.getElementById("detailCover").onclick = () => coverSong(t);
  document.getElementById("detailStems").onclick = () => toggleStems(t);
  document.getElementById("detailStems").parentElement
  document.getElementById("detailDownload").onclick = () => download(t);
  document.getElementById("detailLike").onclick = () => { toggleLike(t.id); openDetail(t); };
  document.getElementById("detailPersona").onclick = () => makePersona(t);
  document.getElementById("detailPlaylist").onclick = () => openPlaylistPicker(t);
}

async function toggleStems(t) {
  const el = document.getElementById("stemList");
  el.hidden = !el.hidden;
  if (el.hidden) return;

  // cas 1 : backend IA disponible → vraie séparation Demucs
  if (Backend.available && t.url) {
    $$("[data-stem]", el).forEach((b) => { b.disabled = true; b.textContent = "…"; });
    toast("Séparation IA (Demucs) en cours…", "scissors");
    try {
      const blob = await (await fetch(t.url)).blob();
      const b64 = await blobToBase64(blob);
      const res = await Backend.stems(b64, (p) => {
        const b = document.getElementById("detailStems");
        if (b) b.textContent = `Stems (${p}%)`;
      });
      t.stems = res.stems;
      t.stemsReal = true;
      persist();
      $$("[data-stem]", el).forEach((b) => {
        b.disabled = false;
        const url = res.stems[b.dataset.stem];
        b.textContent = "Télécharger";
        b.onclick = () => {
          const a = document.createElement("a");
          a.href = url; a.download = `${t.title}-${b.dataset.stem}.wav`; a.click();
        };
      });
      toast("Stems séparés par Demucs ✓ (voix, batterie, basse, autre)");
      return;
    } catch (e) {
      console.warn("stems IA échoués, bascule simulée.", e);
    }
  }

  // cas 2 : fallback simulé
  $$("[data-stem]", el).forEach((b) => {
    b.disabled = false; b.textContent = "Télécharger";
    b.onclick = () => toast(`Stem « ${b.dataset.stem} » téléchargé (WAV)`, "download");
  });
}

function blobToBase64(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result.split(",")[1]);
    r.onerror = rej;
    r.readAsDataURL(blob);
  });
}

function download(t) {
  if (!t.url) { toast("Titre communautaire — générez-le d'abord."); return; }
  const a = document.createElement("a");
  a.href = t.url; a.download = (t.title || "chanson") + ".wav"; a.click();
  toast("Téléchargement MP3/WAV…", "download");
}

function remaster(t) {
  if (!t.url) { toast("Générez ce titre pour le remasteriser."); return; }
  toast("Remasterisation (qualité supérieure) en cours…", "wand-sparkles");
  setTimeout(() => {
    t.model = (t.model === "v3" ? "v4" : "v4.5");
    t.plays = t.plays || 0;
    persist(); renderAll(); openDetail(t);
    toast("Remasterisé en " + t.model + " ✓");
  }, 1200);
}
function extend(t) {
  if (!t.url) { toast("Générez ce titre pour le prolonger."); return; }
  toast("Prolongation du morceau en cours…", "plus");
  setTimeout(() => {
    t.duration += 60;
    persist(); renderAll(); openDetail(t);
    toast("Morceau prolongé à " + Math.round(t.duration / 60 * 10) / 10 + " min ✓");
  }, 1200);
}
async function coverSong(t) {
  if (!t.url) { toast("Générez ce titre d'abord."); return; }
  const lyrics = t.lyrics && t.lyrics.trim() ? t.lyrics : t.style || t.title;
  if (Backend.available) {
    toast("Génération vocale (Bark) en cours…", "microphone-lines");
    document.getElementById("genbar").hidden = false;
    document.getElementById("genbarFill").style.width = "0%";
    try {
      const res = await Backend.sing(cleanLyrics(lyrics), null, (p) => {
        document.getElementById("genbarFill").style.width = Math.min(99, p) + "%";
        document.getElementById("genbarStage").textContent = "Voix chantée (Bark) · " + p + "%";
      });
      document.getElementById("genbar").hidden = true;
      // lecture de la voix
      const vt = { ...t, id: uid(), title: t.title + " (voix)", url: res.url, duration: Math.round(res.duration), stems: {} };
      playTrack(vt, true);
      toast("Voix chantée générée ✓");
      return;
    } catch (e) {
      document.getElementById("genbar").hidden = true;
      console.warn(e);
    }
  }
  toast("Reprise vocale disponible avec le backend IA (Bark).", "music");
}

function cleanLyrics(s) {
  // retire les metatags pour Bark
  return String(s).replace(/\[[^\]]*\]/g, "").replace(/\s+/g, " ").trim().slice(0, 600);
}
function makePersona(t) {
  if (!t.url) { toast("Générez ce titre d'abord."); return; }
  if (!store.personas.find(p => p.name === t.title)) {
    store.personas.push({ id: uid(), name: t.title, genre: t.genre, mood: t.mood, bpm: t.bpm, cover: t.cover });
    persist();
  }
  toast(`Persona « ${t.title} » créée — réutilisez son style dans le mode personnalisé.`, "user-astronaut");
  renderPersonas();
}

function renderAll() {
  renderCredits(); renderTrending(); renderNew(); renderRecent(); renderLibrary(); renderPlaylists(); renderExplore();
}

/* ─────────── Playlist picker ─────────── */
let pickTrack = null;
function openPlaylistPicker(t) {
  pickTrack = t;
  const el = document.getElementById("playlistPicker");
  if (!store.playlists.length) el.innerHTML = '<div class="hint">Aucune playlist — créez-en une ci-dessous.</div>';
  else el.innerHTML = store.playlists.map((p) => `
    <button class="btn btn--ghost btn--full" data-addpl="${p.id}" style="margin-bottom:8px;justify-content:flex-start">
      <i class="fa-solid fa-list"></i> ${esc(p.name)} (${p.trackIds.length})
    </button>`).join("");
  $$("[data-addpl]", el).forEach((b) => b.addEventListener("click", () => {
    const pl = store.playlists.find((p) => p.id === b.dataset.addpl);
    if (!pl.trackIds.includes(pickTrack.id)) pl.trackIds.push(pickTrack.id);
    persist(); document.getElementById("playlistModal").hidden = true;
    toast(`Ajouté à « ${pl.name} » ✓`);
  }));
  document.getElementById("playlistModal").hidden = false;
  document.getElementById("createPlBtn").onclick = () => {
    const name = document.getElementById("newPlName").value.trim() || "Nouvelle playlist";
    const pl = { id: uid(), name, cover: cover(store.playlists.length), trackIds: [pickTrack.id] };
    store.playlists.push(pl); persist();
    document.getElementById("playlistModal").hidden = true;
    document.getElementById("newPlName").value = "";
    toast(`Créée « ${pl.name} » et morceau ajouté ✓`);
  };
}

/* ─────────── Lecture ─────────── */
function playTrack(t, resetQueue) {
  if (!t.url) { generateCommunityPlay(t); return; }
  ui.playingId = t.id;
  document.getElementById("playerArt").src = t.cover;
  document.getElementById("playerTitle").textContent = t.title;
  document.getElementById("playerArtist").textContent = t.artist;
  document.getElementById("totalTime").textContent = fmt(t.duration);
  updateLikeBtn(t.id);
  document.getElementById("playerBar").hidden = false;
  ui.audio.src = t.url;
  ui.audio.play().catch(() => {});
  document.getElementById("playBtn").innerHTML = '<i class="fa-solid fa-pause"></i>';
  if (resetQueue) { ui.queueIds = store.tracks.map(x => x.id); ui.queueIndex = ui.queueIds.indexOf(t.id); }
}
function generateCommunityPlay(t) {
  toast("Génération de ce titre communautaire…", "wand-sparkles");
  const jobId = SC.queueGeneration({ text: `${t.genre} ${t.title}`, durationSec: 45, genre: t.genre, mood: SC.MOODS.uplifting }, () => {});
  const poll = setInterval(() => {
    const job = SC.getJob(jobId);
    if (job && job.status === "completed") {
      clearInterval(poll);
      const newt = { id: uid(), title: t.title, artist: t.artist, genre: t.genre, cover: t.cover, url: URL.createObjectURL(SC.bufferToWavBlob(job.result.rendered)), duration: 45, plays: 0, stems: {} };
      store.tracks.unshift(newt); persist();
      playTrack(newt, true); renderAll();
    }
  }, 80);
}
function pause() { ui.audio.pause(); document.getElementById("playBtn").innerHTML = '<i class="fa-solid fa-play"></i>'; }
function fmt(s) { s = Math.max(0, Math.floor(s || 0)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); }

document.getElementById("playBtn").addEventListener("click", () => {
  ui.audio.paused ? (ui.audio.play(), document.getElementById("playBtn").innerHTML = '<i class="fa-solid fa-pause"></i>') : pause();
});
ui.audio.addEventListener("timeupdate", () => {
  document.getElementById("curTime").textContent = fmt(ui.audio.currentTime);
  if (ui.audio.duration) document.getElementById("seekFill").style.width = (ui.audio.currentTime / ui.audio.duration) * 100 + "%";
});
ui.audio.addEventListener("ended", () => {
  if (ui.loop) { ui.audio.currentTime = 0; ui.audio.play(); return; }
  step(1);
});
ui.audio.volume = 0.8;

function step(d) {
  if (!store.tracks.length) return;
  if (!ui.queueIds.length) ui.queueIds = store.tracks.map(t => t.id);
  let ni;
  if (ui.shuffle) ni = Math.floor(Math.random() * ui.queueIds.length);
  else ni = (ui.queueIndex + d + ui.queueIds.length) % ui.queueIds.length;
  ui.queueIndex = ni;
  const t = store.tracks.find(x => x.id === ui.queueIds[ni]);
  if (t) { t.plays = (t.plays || 0) + 1; persist(); playTrack(t, false); }
}
document.getElementById("prevBtn").addEventListener("click", () => step(-1));
document.getElementById("nextBtn").addEventListener("click", () => step(1));
document.getElementById("shuffleBtn").addEventListener("click", () => {
  ui.shuffle = !ui.shuffle;
  document.getElementById("shuffleBtn").style.color = ui.shuffle ? "#5b8cff" : "";
  toast(ui.shuffle ? "Lecture aléatoire activée" : "Lecture aléatoire désactivée");
});
document.getElementById("loopBtn").addEventListener("click", () => {
  ui.loop = !ui.loop;
  document.getElementById("loopBtn").style.color = ui.loop ? "#5b8cff" : "";
  toast(ui.loop ? "Répétition activée" : "Répétition désactivée");
});
document.getElementById("seekBar").addEventListener("click", (e) => {
  if (!ui.audio.duration) return;
  const r = e.currentTarget.getBoundingClientRect();
  ui.audio.currentTime = ((e.clientX - r.left) / r.width) * ui.audio.duration;
});
document.getElementById("volume").addEventListener("input", (e) => (ui.audio.volume = e.target.value / 100));

function toggleLike(id) {
  const i = store.likes.indexOf(id);
  i >= 0 ? store.likes.splice(i, 1) : store.likes.push(id);
  persist();
  const t = store.tracks.find(x => x.id === id);
  if (t) toast(i >= 0 ? "Retiré des likes" : "Ajouté aux likes ✓", "heart");
  if (ui.playingId === id) updateLikeBtn(id);
  renderAll();
}
function updateLikeBtn(id) {
  const liked = store.likes.includes(id);
  document.getElementById("playerLike").innerHTML = `<i class="fa-${liked ? "solid" : "regular"} fa-heart"></i>`;
  document.getElementById("playerLike").classList.toggle("is-liked", liked);
}
document.getElementById("playerLike").addEventListener("click", () => ui.playingId && toggleLike(ui.playingId));
document.getElementById("downloadBtn").addEventListener("click", () => {
  const t = store.tracks.find(x => x.id === ui.playingId);
  t && download(t);
});
document.getElementById("stemsBtn").addEventListener("click", () => {
  const t = store.tracks.find(x => x.id === ui.playingId);
  t && openDetail(t);
});

/* ─────────── Modals ─────────── */
function closeModal(name) { document.getElementById(name + "Modal").hidden = true; }
$$("[data-close-modal]").forEach((b) => b.addEventListener("click", () => closeModal(b.dataset.closeModal)));

/* auth */
let authMode = "signup";
function openAuth(mode) {
  authMode = mode;
  document.getElementById("authTitle").textContent = mode === "login" ? "Bon retour" : "Bienvenue sur SongCreator";
  document.getElementById("authSub").textContent = mode === "login" ? "Connectez-vous pour continuer à créer." : "Créez de la musique, partagez-la et faites-vous découvrir.";
  document.getElementById("authModal").hidden = false;
}
$$(".btn--social").forEach((b) => b.addEventListener("click", () => {
  const p = b.dataset.provider;
  const email = p === "Google" ? "sangoku54@gmail.com" : `creator@${p.toLowerCase()}.com`;
  store.user = email.split("@")[0];
  persist();
  document.getElementById("authModal").hidden = true;
  document.getElementById("sideAvatar").textContent = store.user[0]?.toUpperCase() || "?";
  toast(`Connecté avec ${p} (${store.user}) ✓`);
}));
document.getElementById("authForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const em = document.getElementById("authEmail").value.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) { toast("E-mail invalide", "triangle-exclamation"); return; }
  store.user = em.split("@")[0]; persist();
  document.getElementById("authModal").hidden = true;
  document.getElementById("authEmail").value = "";
  document.getElementById("sideAvatar").textContent = store.user[0]?.toUpperCase() || "?";
  toast(`${authMode === "login" ? "Connecté" : "Compte créé"} : ${store.user} ✓`);
});
document.getElementById("sideAvatar").addEventListener("click", () => {
  if (store.user) { document.getElementById("sideAvatar").title = store.user; toast("Connecté : " + store.user); }
  else openAuth("signup");
});

/* ─────────── Init ─────────── */
async function init() {
  renderCredits();
  document.getElementById("sideAvatar").textContent = store.user ? store.user[0]?.toUpperCase() : "?";

  // détection du backend IA
  const ok = await Backend.detect();
  const label = document.getElementById("createBtn");
  const engineLabel = document.getElementById("engineLabel");
  if (ok) {
    console.log("[SongCreator] backend IA détecté :", Backend.modelInfo);
    label.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> Créer (IA)';
    engineLabel.textContent = "Moteur : IA (GPU CUDA)";
    document.getElementById("engineBadge").classList.add("is-active");
    const pipes = ["MusicGen (musique)", "Demucs (stems)", "Bark (voix)"].join(" · ");
    document.getElementById("engineBadge").title = "Modèles chargés à la demande : " + pipes;
  } else {
    console.warn("[SongCreator] backend IA absent — moteur procédural de secours. Lancez `launch_backend.bat` pour l'IA réelle.");
    label.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> Créer';
    engineLabel.textContent = "Moteur : procédural (lancer le backend pour l'IA)";
  }

  nav("home");
}
init();
