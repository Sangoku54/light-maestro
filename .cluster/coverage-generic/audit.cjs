var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/engine/dmx-color.ts
function hexToRgb(hex) {
  const h = hex.replace("#", "");
  return [parseInt(h.substring(0, 2), 16), parseInt(h.substring(2, 4), 16), parseInt(h.substring(4, 6), 16)];
}
function applyHueShift([r, g, b], deg) {
  if (deg === 0) return [r, g, b];
  const nr = r / 255, ng = g / 255, nb = b / 255;
  const mx = Math.max(nr, ng, nb), mn = Math.min(nr, ng, nb);
  const l = (mx + mn) / 2;
  if (mx === mn) return [r, g, b];
  const d = mx - mn;
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h;
  if (mx === nr) h = ((ng - nb) / d + (ng < nb ? 6 : 0)) * 60;
  else if (mx === ng) h = ((nb - nr) / d + 2) * 60;
  else h = ((nr - ng) / d + 4) * 60;
  h = (h + deg) % 360;
  if (h < 0) h += 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(h / 60 % 2 - 1));
  const m = l - c / 2;
  let r2, g2, b2;
  if (h < 60) {
    r2 = c;
    g2 = x;
    b2 = 0;
  } else if (h < 120) {
    r2 = x;
    g2 = c;
    b2 = 0;
  } else if (h < 180) {
    r2 = 0;
    g2 = c;
    b2 = x;
  } else if (h < 240) {
    r2 = 0;
    g2 = x;
    b2 = c;
  } else if (h < 300) {
    r2 = x;
    g2 = 0;
    b2 = c;
  } else {
    r2 = c;
    g2 = 0;
    b2 = x;
  }
  return [Math.round((r2 + m) * 255), Math.round((g2 + m) * 255), Math.round((b2 + m) * 255)];
}
function colorDistance(hex1, hex2) {
  const [r1, g1, b1] = hexToRgb(hex1);
  const [r2, g2, b2] = hexToRgb(hex2);
  return Math.sqrt(2 * (r1 - r2) ** 2 + 4 * (g1 - g2) ** 2 + 3 * (b1 - b2) ** 2);
}
function classifyColor(r, g, b) {
  if (r > 200 && g > 200 && b > 200) return "white";
  if (r < 50 && g < 50 && b < 50) return "black";
  const max = Math.max(r, g, b);
  if (max === r) {
    if (g > b * 1.5) return "yellow";
    if (b > g * 1.5) return "magenta";
    if (r > g * 2 && r > b * 2) return "red";
    return "orange";
  }
  if (max === g) {
    if (r > b * 1.5) return "yellow";
    return "green";
  }
  if (max === b) {
    if (r > g * 1.5) return "magenta";
    if (r > g * 0.6) return "purple";
    return "blue";
  }
  return "white";
}
function matchCapToCategory(capName, category) {
  if (!capName) return 0;
  const n = capName.trim();
  const kw = { red: ["Red", "Rouge", "Dark Red", "Light Red", "Deep Red", "Red (1)", "Red (2)"], blue: ["Blue", "Bleu", "Cyan", "Dark Blue", "Light Blue", "Sky Blue", "Blue (1)", "Blue (2)"], green: ["Green", "Vert", "Lime", "Dark Green", "Light Green", "Green (1)", "Green (2)"], yellow: ["Yellow", "Jaune", "Amber", "Ambre", "Gold", "Yellow (1)", "Yellow (2)"], white: ["White", "Blanc", "Open", "Warm White", "Cold White", "Neutral White", "Bright", "White (1)", "White (2)"], magenta: ["Magenta", "Pink", "Rose", "Fuchsia", "Magenta (1)", "Magenta (2)", "Pink (1)", "Pink (2)"], cyan: ["Cyan", "Turquoise", "Teal", "Aqua", "Cyan (1)", "Cyan (2)"], orange: ["Orange", "Orange (1)", "Orange (2)"], purple: ["Purple", "Violet", "Pourpre", "UV", "Lavender", "Mauve", "Indigo", "Purple (1)", "Purple (2)", "UV (1)"], pink: ["Pink", "Rose", "Salmon", "Pink (1)", "Pink (2)"], amber: ["Amber", "Ambre", "Gold", "Amber (1)", "Amber (2)"] };
  const k = kw[category] || [category];
  const low = n.toLowerCase();
  for (const kk of k) {
    const kl = kk.toLowerCase();
    if (low === kl) return 10;
    if (low.startsWith(kl + " ")) return 9;
    if (low.startsWith(kl + "(")) return 9;
    if (low.includes(kl)) return 5;
  }
  return 0;
}
function mapIntensity(level, energy, tier, tierMults) {
  const ABSOLUTE_MIN = 0;
  let val;
  if (level === "dynamic") {
    val = Math.round(Math.max(ABSOLUTE_MIN, 20 + energy * 235));
  } else {
    let lo, hi;
    switch (level) {
      case "very-low":
        lo = 40;
        hi = 130;
        break;
      case "low":
        lo = 100;
        hi = 200;
        break;
      case "medium":
        lo = 140;
        hi = 240;
        break;
      case "high":
        lo = 180;
        hi = 255;
        break;
      case "very-high":
        lo = 200;
        hi = 255;
        break;
      default:
        lo = 120;
        hi = 220;
        break;
    }
    val = Math.round(Math.max(ABSOLUTE_MIN, lo + Math.max(0, Math.min(1, energy)) * (hi - lo)));
  }
  let tierMult = tier === "primary" || tier === "other" ? 1 : tier === "secondary" ? 0.7 : 0.4;
  if (tierMults) {
    if (tier === "primary") tierMult *= tierMults.primary / 100;
    else if (tier === "secondary") tierMult *= tierMults.secondary / 100;
    else if (tier === "tertiary") tierMult *= tierMults.tertiary / 100;
  }
  return Math.round(val * tierMult);
}
function buildRgbSegments(colourChannels) {
  const segments = [];
  const used = /* @__PURE__ */ new Set();
  for (let i = 0; i < colourChannels.length; i++) {
    if (used.has(i)) continue;
    let ri = -1;
    for (let j = 0; j < colourChannels.length; j++) {
      if (!used.has(j) && !/\bfine\b/i.test(colourChannels[j].name) && isRed.test(colourChannels[j].name)) {
        ri = j;
        break;
      }
    }
    if (ri < 0) continue;
    let gi = -1;
    for (let j = 0; j < colourChannels.length; j++) {
      if (!used.has(j) && j !== ri && !/\bfine\b/i.test(colourChannels[j].name) && isGreen.test(colourChannels[j].name)) {
        gi = j;
        break;
      }
    }
    if (gi < 0) continue;
    let bi = -1;
    for (let j = 0; j < colourChannels.length; j++) {
      if (!used.has(j) && j !== ri && j !== gi && !/\bfine\b/i.test(colourChannels[j].name) && isBlue.test(colourChannels[j].name)) {
        bi = j;
        break;
      }
    }
    if (bi < 0) continue;
    let wi = -1;
    for (let j = 0; j < colourChannels.length; j++) {
      if (!used.has(j) && j !== ri && j !== gi && j !== bi && !/\bfine\b/i.test(colourChannels[j].name) && isWhite.test(colourChannels[j].name)) {
        wi = j;
        break;
      }
    }
    let ai = -1;
    for (let j = 0; j < colourChannels.length; j++) {
      if (!used.has(j) && j !== ri && j !== gi && j !== bi && j !== wi && !/\bfine\b/i.test(colourChannels[j].name) && isAmber.test(colourChannels[j].name)) {
        ai = j;
        break;
      }
    }
    let uvi = -1;
    for (let j = 0; j < colourChannels.length; j++) {
      if (!used.has(j) && j !== ri && j !== gi && j !== bi && j !== wi && j !== ai && !/\bfine\b/i.test(colourChannels[j].name) && isUv.test(colourChannels[j].name)) {
        uvi = j;
        break;
      }
    }
    used.add(ri);
    used.add(gi);
    used.add(bi);
    if (wi >= 0) used.add(wi);
    if (ai >= 0) used.add(ai);
    if (uvi >= 0) used.add(uvi);
    segments.push({ r: colourChannels[ri].offset, g: colourChannels[gi].offset, b: colourChannels[bi].offset, w: wi >= 0 ? colourChannels[wi].offset : null, a: ai >= 0 ? colourChannels[ai].offset : null, uv: uvi >= 0 ? colourChannels[uvi].offset : null });
  }
  return segments;
}
function findBestWheelCap(caps, paletteHex) {
  if (caps.length === 0) return null;
  const [r, g, b] = hexToRgb(paletteHex);
  const cat = classifyColor(r, g, b);
  let bestName = null;
  for (const cap of caps) {
    if (!cap.name) continue;
    const s = matchCapToCategory(cap.name, cat);
    if (s > (bestName?.score ?? 0)) bestName = { cap, score: s };
  }
  if (bestName && bestName.score >= 5) return bestName.cap;
  let bestCap = null;
  let bestDist = Infinity;
  for (const cap of caps) {
    if (cap.color) {
      const d = colorDistance(paletteHex, cap.color);
      if (d < bestDist) {
        bestDist = d;
        bestCap = cap;
      }
    }
  }
  if (bestCap && bestDist < 350) return bestCap;
  if (bestName && bestName.score > 0) return bestName.cap;
  const catToWheelPos = { red: 0.1, orange: 0.2, yellow: 0.3, green: 0.42, cyan: 0.55, blue: 0.68, magenta: 0.78, purple: 0.78, white: 0.02, black: 0.02 };
  const wheelPos = catToWheelPos[cat] ?? 0.5;
  return caps[Math.floor(wheelPos * caps.length) % caps.length];
}
var TIER_HUE, startsWithRgb, hasColorWord, isRed, isGreen, isBlue, isWhite, isAmber, isUv, isPresetMode;
var init_dmx_color = __esm({
  "src/engine/dmx-color.ts"() {
    TIER_HUE = { primary: 0, secondary: 120, tertiary: 240, other: 0 };
    startsWithRgb = /^(red|green|blue|r|g|b|rouge|vert|bleu|rojo|verde|azul)(\s*\(?\d*\)?)?$/i;
    hasColorWord = /\b(red|green|blue|white|amber|uv|laser|rouge|vert|bleu|blanc|ambre|rojo|verde|azul|blanco)\b/i;
    isRed = /\b(red|r|rouge|rojo)\b/i;
    isGreen = /\b(green|g|vert|verde)\b/i;
    isBlue = /\b(blue|b|bleu|azul)\b/i;
    isWhite = /\b(white|w|blanc|blanco)\b/i;
    isAmber = /\b(amber|ambre|a|naranja)\b/i;
    isUv = /\b(uv|ultraviolet|ultra\s*violet)\b/i;
    isPresetMode = /presets?|macro|auto|sound/i;
  }
});

// src/engine/fixture-analyzer.ts
function laserGateValue(v) {
  return v > 22 ? 255 : 0;
}
function hasLaserColorGateCaps(ch) {
  const caps = ch.capabilities ?? [];
  if (caps.length === 0) return false;
  return caps.some(
    (c) => /(red|green|blue|amber|cyan|magenta|yellow|white).*(laser|beam)|(laser|beam).*(red|green|blue|amber|cyan|magenta|yellow|white)/i.test(c.name ?? "")
  );
}
function capMid(cap) {
  if (!cap) return 128;
  return Math.round((cap.min + cap.max) / 2);
}
function synthPatternCaps(count = 8) {
  const caps = [];
  const step = 256 / count;
  for (let i = 0; i < count; i++) {
    caps.push({
      min: Math.floor(i * step),
      max: Math.max(Math.floor(i * step), Math.floor((i + 1) * step) - 1),
      name: `Pattern ${i + 1}`
    });
  }
  return caps;
}
function pickLaserModeCap(caps) {
  const byName = (re) => caps.find((c) => re.test(c.name ?? ""));
  return byName(/dmx|dynamic|manual/i) ?? byName(/auto/i) ?? caps.find((c) => c.max >= 200 && c.min > 0) ?? caps.find((c) => c.min > 0) ?? { min: 128, max: 255, name: "DMX" };
}
function isLaserFixture(pf, channels) {
  const isVideoProjector = channels.some(
    (c) => /^(input select|lens|lens function|lens control|geometry|keystone|(custom )?masking|fade in|fade out|light output|slideshow|white balance|dvi|hdmi|sdi)/i.test((c.name ?? "").trim())
  );
  if (isVideoProjector) return false;
  const norm = String(pf.fixtureType ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (norm.includes("laser")) return true;
  const laserSig = channels.some(
    (c) => /laser/i.test(c.name ?? "") || (c.capabilities ?? []).some((cap) => /laser/i.test(cap.name ?? ""))
  );
  if (laserSig) return true;
  const names = channels.map((c) => (c.name ?? "").toLowerCase());
  const hasPattern = names.some((n) => /\bpattern\b/.test(n));
  const hasScanAxis = names.some(
    (n) => /(horizontal|vertical)\s*(angle|movement|position)/.test(n) || /\bscan/.test(n) || /\bcircular/.test(n)
  );
  const hasColor = channels.some(
    (c) => /\bcolor|colour\b/i.test(c.name ?? "") && (c.type === "Colour" || (c.capabilities ?? []).some((cap) => cap.color))
  );
  return hasPattern && hasScanAxis && hasColor;
}
function analyzeFixtureChannels(pf, def) {
  const channels = def?.modes[pf.modeIndex]?.channels ?? [];
  const isLaser = isLaserFixture(pf, channels);
  const fa = {
    fixture: pf,
    intensityOffset: null,
    ledIntensityOffsets: [],
    shutterOffset: null,
    effectOffset: null,
    effectCaps: null,
    rgbSegments: [],
    rgbOffsets: null,
    wheelOffset: null,
    wheelCaps: [],
    panOffset: null,
    panFineOffset: null,
    panOffsets: [],
    tiltOffset: null,
    tiltFineOffset: null,
    tiltOffsets: [],
    goboOffset: null,
    goboCaps: [],
    zoomOffset: null,
    frostOffset: null,
    irisOffset: null,
    focusOffset: null,
    beamOffset: null,
    prismOffset: null,
    prismCaps: [],
    speedOffset: null,
    macroOffsets: [],
    presetOverrideOffsets: [],
    isLaser,
    laserColorMode: "none",
    laserModeOffset: null,
    laserModeCaps: [],
    laserColorGateOffset: null,
    laserColorGateCaps: [],
    patternOffset: null,
    patternCaps: [],
    scanXOffset: null,
    scanYOffset: null,
    laserSpeedScanOffset: null,
    laserSpeedPatternOffset: null,
    laserRotationOffsets: [],
    blankOffset: null,
    channelCount: channels.length,
    universeIndex: 0
  };
  const colourChannels = [];
  for (let i = 0; i < channels.length; i++) {
    const ch = channels[i];
    const off = ch.offset ?? i;
    const chName = ch.name?.trim() ?? "";
    if (isPresetMode.test(chName) && !ch.capabilities?.length) {
      fa.presetOverrideOffsets.push(off);
      continue;
    }
    if (ch.type === "Macro" && !ch.capabilities?.length) {
      fa.macroOffsets.push(off);
      continue;
    }
    const isShutterDimmer = /\bdimmer\b/i.test(chName) && ch.type === "Shutter";
    if (isShutterDimmer && fa.intensityOffset === null) {
      fa.intensityOffset = off;
    }
    const chNameLower = chName.toLowerCase();
    const isRgbNamed = /^(red|green|blue|r|g|b)(\s*\(?\d*\)?)?$/i.test(chNameLower);
    const hasColorCaps = ch.capabilities?.some((cap) => cap.color);
    const isLaserColorNamed = isLaser && (isRed.test(chName) || isGreen.test(chName) || isBlue.test(chName)) && !COLOUR_AUX_RE.test(chName);
    if (isLaser && fa.laserColorGateOffset === null && hasLaserColorGateCaps(ch)) {
      fa.laserColorGateOffset = off;
      fa.laserColorGateCaps = ch.capabilities ?? [];
      fa.laserColorMode = "gate";
      continue;
    }
    if (isRgbNamed || isLaserColorNamed || startsWithRgb.test(chName) || ch.type === "Colour" || ch.type === "Beam" && hasColorWord.test(chName) || hasColorCaps) {
      colourChannels.push({ offset: off, name: chName, caps: ch.capabilities });
      continue;
    }
    if (isLaser) {
      let matched = false;
      if (/^(mode|mode\s*select|mode\s*selection)$/i.test(chName) || !fa.laserModeOffset && /laser.*mode|mode.*laser/i.test(chName)) {
        if (fa.laserModeOffset === null) {
          fa.laserModeOffset = off;
          fa.laserModeCaps = ch.capabilities ?? [];
        }
        matched = true;
      } else if (fa.laserModeOffset === null && /^(show\s*mode|program|show)$/i.test(chName)) {
        fa.laserModeOffset = off;
        fa.laserModeCaps = ch.capabilities ?? [];
        matched = true;
      } else if (/scann?ing\s*speed/i.test(chName)) {
        if (fa.laserSpeedScanOffset === null) fa.laserSpeedScanOffset = off;
        matched = true;
      } else if (/(dynamic|pattern).*speed|speed.*(dynamic|pattern)/i.test(chName)) {
        if (fa.laserSpeedPatternOffset === null) fa.laserSpeedPatternOffset = off;
        matched = true;
      } else if (/rotat\w*[\s_-]*(x|y|z)|\b(x|y|z)[\s_-]*(axis[\s_-]*)?(rolling|spin|rotat\w*)/i.test(chName)) {
        fa.laserRotationOffsets.push(off);
        matched = true;
      } else if (/laser.*(rotat\w*|rolling|spin)|(red|green|blue|white|amber|yellow|color).*(rotat\w*|rolling|spin)|(rotat\w*|rolling|spin).*laser/i.test(chName)) {
        fa.laserRotationOffsets.push(off);
        matched = true;
      } else if (/^(x|y)[\s_-]*(axis[\s_-]*)?(moving|movement|position|angle)/i.test(chName)) {
        if (chName[0].toLowerCase() === "x" && fa.scanXOffset === null) fa.scanXOffset = off;
        else if (chName[0].toLowerCase() === "y" && fa.scanYOffset === null) fa.scanYOffset = off;
        matched = true;
      } else if (/horizontal.*(angle|movement|position)/i.test(chName)) {
        if (fa.scanXOffset === null) fa.scanXOffset = off;
        matched = true;
      } else if (/vertical.*(angle|movement|position)/i.test(chName)) {
        if (fa.scanYOffset === null) fa.scanYOffset = off;
        matched = true;
      } else if (fa.laserColorGateOffset === null && hasLaserColorGateCaps(ch)) {
        fa.laserColorGateOffset = off;
        fa.laserColorGateCaps = ch.capabilities ?? [];
        fa.laserColorMode = "gate";
        matched = true;
      } else if (/\bblank/i.test(chName)) {
        if (fa.blankOffset === null) fa.blankOffset = off;
        matched = true;
      } else if (/\bpattern\b/i.test(chName)) {
        if (fa.patternOffset === null) {
          fa.patternOffset = off;
          fa.patternCaps = ch.capabilities ?? [];
        }
        matched = true;
      }
      if (matched) continue;
    }
    switch (ch.type) {
      case "Intensity":
        if (fa.intensityOffset === null) {
          fa.intensityOffset = off;
        } else {
          fa.ledIntensityOffsets.push(off);
        }
        break;
      case "Shutter":
      case "Strobe":
        if (fa.shutterOffset === null) fa.shutterOffset = off;
        break;
      case "Effect": {
        const hasCaps = (ch.capabilities?.length ?? 0) > 0;
        if (fa.effectOffset === null) {
          fa.effectOffset = off;
          fa.effectCaps = ch.capabilities ?? null;
        } else if ((fa.effectCaps?.length ?? 0) === 0 && hasCaps) {
          fa.effectOffset = off;
          fa.effectCaps = ch.capabilities;
        }
        break;
      }
      case "Pan":
        if (fa.panOffset === null) fa.panOffset = off;
        else if (fa.panFineOffset === null && /\bfine\b/i.test(chName)) fa.panFineOffset = off;
        if (!/\bfine\b/i.test(chName)) fa.panOffsets.push(off);
        break;
      case "Tilt":
        if (fa.tiltOffset === null) fa.tiltOffset = off;
        else if (fa.tiltFineOffset === null && /\bfine\b/i.test(chName)) fa.tiltFineOffset = off;
        if (!/\bfine\b/i.test(chName)) fa.tiltOffsets.push(off);
        break;
      case "Gobo":
        if (fa.goboOffset === null) {
          fa.goboOffset = off;
          fa.goboCaps = ch.capabilities ?? [];
        }
        break;
      case "Prism":
        if (fa.prismOffset === null) {
          fa.prismOffset = off;
          fa.prismCaps = ch.capabilities ?? [];
        }
        break;
      case "Zoom":
        if (fa.zoomOffset === null) fa.zoomOffset = off;
        break;
      case "Frost":
        if (fa.frostOffset === null) fa.frostOffset = off;
        break;
      case "Focus":
        if (fa.focusOffset === null) fa.focusOffset = off;
        break;
      case "Iris":
        if (fa.irisOffset === null) fa.irisOffset = off;
        break;
      case "Speed":
        if (fa.speedOffset === null) fa.speedOffset = off;
        break;
      case "Beam": {
        if (/\bzoom\b/.test(chNameLower)) {
          if (fa.zoomOffset === null) fa.zoomOffset = off;
        } else if (/\bfrost\b/.test(chNameLower)) {
          if (fa.frostOffset === null) fa.frostOffset = off;
        } else if (/\biris\b/.test(chNameLower)) {
          if (fa.irisOffset === null) fa.irisOffset = off;
        } else if (/\bfocus\b/.test(chNameLower)) {
          if (fa.focusOffset === null) fa.focusOffset = off;
        } else if (fa.beamOffset === null) {
          fa.beamOffset = off;
        }
        break;
      }
      case "Macro": {
        if (/\bprism\b/i.test(chName)) {
          if (fa.prismOffset === null) {
            fa.prismOffset = off;
            fa.prismCaps = ch.capabilities ?? [];
          }
        } else if (/\bgobo\b/i.test(chName)) {
          if (fa.goboOffset === null) {
            fa.goboOffset = off;
            fa.goboCaps = ch.capabilities ?? [];
          }
        } else if (/\beffect\b/i.test(chName)) {
          if (fa.effectOffset === null) {
            fa.effectOffset = off;
            fa.effectCaps = ch.capabilities ?? null;
          }
        } else if (/\bspeed\b/i.test(chName)) {
          if (fa.speedOffset === null) fa.speedOffset = off;
        } else if (fa.effectOffset === null) {
          fa.effectOffset = off;
          fa.effectCaps = ch.capabilities ?? null;
        }
        break;
      }
    }
  }
  if (colourChannels.length > 0) {
    const hasRgbStart = colourChannels.some((c) => startsWithRgb.test(c.name));
    const hasRgbWords = colourChannels.some((c) => isRed.test(c.name)) && colourChannels.some((c) => isGreen.test(c.name)) && colourChannels.some((c) => isBlue.test(c.name));
    const hasRgbNames = (hasRgbStart || hasRgbWords) && colourChannels.length >= 3;
    const hasColorCaps = colourChannels.some((c) => c.caps?.some((cap) => cap.color));
    if (hasRgbNames) {
      fa.rgbSegments = buildRgbSegments(colourChannels);
      const rIdx = colourChannels.findIndex((c) => !/\bfine\b/i.test(c.name) && /red|\br\b/i.test(c.name));
      const gIdx = colourChannels.findIndex((c) => !/\bfine\b/i.test(c.name) && /green|\bg\b/i.test(c.name));
      const bIdx = colourChannels.findIndex((c) => !/\bfine\b/i.test(c.name) && /blue|\bb\b/i.test(c.name));
      if (rIdx >= 0 && gIdx >= 0 && bIdx >= 0) {
        fa.rgbOffsets = [colourChannels[rIdx].offset, colourChannels[gIdx].offset, colourChannels[bIdx].offset];
      } else {
        fa.rgbOffsets = colourChannels.slice(0, 3).map((c) => c.offset);
      }
    } else if (hasColorCaps) {
      const wheel = colourChannels.find((c) => c.caps?.some((cap) => cap.color));
      if (wheel) {
        fa.wheelOffset = wheel.offset;
        fa.wheelCaps = wheel.caps ?? [];
      }
    } else if (colourChannels.filter((c) => !COLOUR_AUX_RE.test(c.name)).length >= 3) {
      const plainColours = colourChannels.filter((c) => !COLOUR_AUX_RE.test(c.name));
      fa.rgbSegments = buildRgbSegments(plainColours);
      if (fa.rgbSegments.length === 0) {
        fa.rgbSegments = [{ r: plainColours[0].offset, g: plainColours[1].offset, b: plainColours[2].offset, w: null }];
      }
      fa.rgbOffsets = plainColours.slice(0, 3).map((c) => c.offset);
    } else if (colourChannels.length === 1) {
      fa.wheelOffset = colourChannels[0].offset;
      const ch = channels.find((c, idx) => (c.offset ?? idx) === colourChannels[0].offset);
      if (ch?.capabilities && ch.capabilities.length > 0) {
        fa.wheelCaps = ch.capabilities;
      }
    }
  }
  if (fa.wheelOffset !== null && fa.wheelCaps.length === 0) {
    const ch = channels.find((c, idx) => (c.offset ?? idx) === fa.wheelOffset);
    if (ch?.capabilities && ch.capabilities.length > 0) {
      fa.wheelCaps = ch.capabilities;
    }
  }
  if (fa.isLaser && fa.wheelOffset === null && fa.rgbSegments.length === 0) {
    const plainColours = colourChannels.filter((c) => !COLOUR_AUX_RE.test(c.name));
    const red = plainColours.find((c) => isRed.test(c.name));
    const green = plainColours.find((c) => isGreen.test(c.name));
    const blue = plainColours.find((c) => isBlue.test(c.name));
    if (red && green) fa.rgbOffsets = [red.offset, green.offset];
    else if (red && blue) fa.rgbOffsets = [red.offset, blue.offset];
    else if (green && blue) fa.rgbOffsets = [green.offset, blue.offset];
  }
  fa.laserColorMode = fa.rgbOffsets !== null ? "rgb" : fa.wheelOffset !== null ? "wheel" : "none";
  if (fa.patternOffset !== null && (fa.patternCaps.length === 0 || fa.patternCaps.length === 1 && fa.patternCaps[0].max - fa.patternCaps[0].min >= 255)) {
    fa.patternCaps = synthPatternCaps(8);
  }
  if (!_logged.has(pf.id)) {
    _logged.add(pf.id);
    console.log(
      `[analyzeFixtureChannels] ${pf.name} (${pf.fixtureType}, tier=${pf.tier}, addr=${pf.startAddress})`,
      `| colourChannels: ${colourChannels.length} [${colourChannels.map((c) => `${c.name}@${c.offset}`).join(", ")}]`,
      `| rgbSegments: ${fa.rgbSegments.length > 0 ? fa.rgbSegments.map((s) => `R${s.r}G${s.g}B${s.b}`).join("; ") : "\u2205"}`,
      `| rgbOffsets: ${fa.rgbOffsets ? fa.rgbOffsets.join(",") : "\u2205"}`,
      `| wheelOffset: ${fa.wheelOffset} (caps:${fa.wheelCaps.length})`,
      `| intensityOffset: ${fa.intensityOffset} shutterOffset: ${fa.shutterOffset}`,
      `| panOffsets: [${fa.panOffsets.join(",")}] tiltOffsets: [${fa.tiltOffsets.join(",")}]`,
      `| laser: ${fa.isLaser} (${fa.laserColorMode}) pattern:${fa.patternOffset} scanX:${fa.scanXOffset} scanY:${fa.scanYOffset} rot:[${fa.laserRotationOffsets.join(",")}] blank:${fa.blankOffset}`
    );
  }
  return fa;
}
function analyzeChannels(pf, def) {
  return analyzeFixtureChannels(pf, def);
}
var COLOUR_AUX_RE, _logged;
var init_fixture_analyzer = __esm({
  "src/engine/fixture-analyzer.ts"() {
    init_dmx_color();
    COLOUR_AUX_RE = /rotation|rolling|move|movement|speed|scan|strobe|effect|macro/i;
    _logged = /* @__PURE__ */ new Set();
  }
});

// node_modules/react/cjs/react.production.min.js
var require_react_production_min = __commonJS({
  "node_modules/react/cjs/react.production.min.js"(exports2) {
    "use strict";
    var l = Symbol.for("react.element");
    var n = Symbol.for("react.portal");
    var p = Symbol.for("react.fragment");
    var q = Symbol.for("react.strict_mode");
    var r = Symbol.for("react.profiler");
    var t = Symbol.for("react.provider");
    var u = Symbol.for("react.context");
    var v = Symbol.for("react.forward_ref");
    var w = Symbol.for("react.suspense");
    var x = Symbol.for("react.memo");
    var y = Symbol.for("react.lazy");
    var z = Symbol.iterator;
    function A(a) {
      if (null === a || "object" !== typeof a) return null;
      a = z && a[z] || a["@@iterator"];
      return "function" === typeof a ? a : null;
    }
    var B = { isMounted: function() {
      return false;
    }, enqueueForceUpdate: function() {
    }, enqueueReplaceState: function() {
    }, enqueueSetState: function() {
    } };
    var C = Object.assign;
    var D = {};
    function E(a, b, e) {
      this.props = a;
      this.context = b;
      this.refs = D;
      this.updater = e || B;
    }
    E.prototype.isReactComponent = {};
    E.prototype.setState = function(a, b) {
      if ("object" !== typeof a && "function" !== typeof a && null != a) throw Error("setState(...): takes an object of state variables to update or a function which returns an object of state variables.");
      this.updater.enqueueSetState(this, a, b, "setState");
    };
    E.prototype.forceUpdate = function(a) {
      this.updater.enqueueForceUpdate(this, a, "forceUpdate");
    };
    function F() {
    }
    F.prototype = E.prototype;
    function G(a, b, e) {
      this.props = a;
      this.context = b;
      this.refs = D;
      this.updater = e || B;
    }
    var H = G.prototype = new F();
    H.constructor = G;
    C(H, E.prototype);
    H.isPureReactComponent = true;
    var I = Array.isArray;
    var J = Object.prototype.hasOwnProperty;
    var K = { current: null };
    var L = { key: true, ref: true, __self: true, __source: true };
    function M(a, b, e) {
      var d, c = {}, k = null, h = null;
      if (null != b) for (d in void 0 !== b.ref && (h = b.ref), void 0 !== b.key && (k = "" + b.key), b) J.call(b, d) && !L.hasOwnProperty(d) && (c[d] = b[d]);
      var g = arguments.length - 2;
      if (1 === g) c.children = e;
      else if (1 < g) {
        for (var f = Array(g), m = 0; m < g; m++) f[m] = arguments[m + 2];
        c.children = f;
      }
      if (a && a.defaultProps) for (d in g = a.defaultProps, g) void 0 === c[d] && (c[d] = g[d]);
      return { $$typeof: l, type: a, key: k, ref: h, props: c, _owner: K.current };
    }
    function N(a, b) {
      return { $$typeof: l, type: a.type, key: b, ref: a.ref, props: a.props, _owner: a._owner };
    }
    function O(a) {
      return "object" === typeof a && null !== a && a.$$typeof === l;
    }
    function escape(a) {
      var b = { "=": "=0", ":": "=2" };
      return "$" + a.replace(/[=:]/g, function(a2) {
        return b[a2];
      });
    }
    var P = /\/+/g;
    function Q(a, b) {
      return "object" === typeof a && null !== a && null != a.key ? escape("" + a.key) : b.toString(36);
    }
    function R(a, b, e, d, c) {
      var k = typeof a;
      if ("undefined" === k || "boolean" === k) a = null;
      var h = false;
      if (null === a) h = true;
      else switch (k) {
        case "string":
        case "number":
          h = true;
          break;
        case "object":
          switch (a.$$typeof) {
            case l:
            case n:
              h = true;
          }
      }
      if (h) return h = a, c = c(h), a = "" === d ? "." + Q(h, 0) : d, I(c) ? (e = "", null != a && (e = a.replace(P, "$&/") + "/"), R(c, b, e, "", function(a2) {
        return a2;
      })) : null != c && (O(c) && (c = N(c, e + (!c.key || h && h.key === c.key ? "" : ("" + c.key).replace(P, "$&/") + "/") + a)), b.push(c)), 1;
      h = 0;
      d = "" === d ? "." : d + ":";
      if (I(a)) for (var g = 0; g < a.length; g++) {
        k = a[g];
        var f = d + Q(k, g);
        h += R(k, b, e, f, c);
      }
      else if (f = A(a), "function" === typeof f) for (a = f.call(a), g = 0; !(k = a.next()).done; ) k = k.value, f = d + Q(k, g++), h += R(k, b, e, f, c);
      else if ("object" === k) throw b = String(a), Error("Objects are not valid as a React child (found: " + ("[object Object]" === b ? "object with keys {" + Object.keys(a).join(", ") + "}" : b) + "). If you meant to render a collection of children, use an array instead.");
      return h;
    }
    function S(a, b, e) {
      if (null == a) return a;
      var d = [], c = 0;
      R(a, d, "", "", function(a2) {
        return b.call(e, a2, c++);
      });
      return d;
    }
    function T(a) {
      if (-1 === a._status) {
        var b = a._result;
        b = b();
        b.then(function(b2) {
          if (0 === a._status || -1 === a._status) a._status = 1, a._result = b2;
        }, function(b2) {
          if (0 === a._status || -1 === a._status) a._status = 2, a._result = b2;
        });
        -1 === a._status && (a._status = 0, a._result = b);
      }
      if (1 === a._status) return a._result.default;
      throw a._result;
    }
    var U = { current: null };
    var V = { transition: null };
    var W = { ReactCurrentDispatcher: U, ReactCurrentBatchConfig: V, ReactCurrentOwner: K };
    function X() {
      throw Error("act(...) is not supported in production builds of React.");
    }
    exports2.Children = { map: S, forEach: function(a, b, e) {
      S(a, function() {
        b.apply(this, arguments);
      }, e);
    }, count: function(a) {
      var b = 0;
      S(a, function() {
        b++;
      });
      return b;
    }, toArray: function(a) {
      return S(a, function(a2) {
        return a2;
      }) || [];
    }, only: function(a) {
      if (!O(a)) throw Error("React.Children.only expected to receive a single React element child.");
      return a;
    } };
    exports2.Component = E;
    exports2.Fragment = p;
    exports2.Profiler = r;
    exports2.PureComponent = G;
    exports2.StrictMode = q;
    exports2.Suspense = w;
    exports2.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED = W;
    exports2.act = X;
    exports2.cloneElement = function(a, b, e) {
      if (null === a || void 0 === a) throw Error("React.cloneElement(...): The argument must be a React element, but you passed " + a + ".");
      var d = C({}, a.props), c = a.key, k = a.ref, h = a._owner;
      if (null != b) {
        void 0 !== b.ref && (k = b.ref, h = K.current);
        void 0 !== b.key && (c = "" + b.key);
        if (a.type && a.type.defaultProps) var g = a.type.defaultProps;
        for (f in b) J.call(b, f) && !L.hasOwnProperty(f) && (d[f] = void 0 === b[f] && void 0 !== g ? g[f] : b[f]);
      }
      var f = arguments.length - 2;
      if (1 === f) d.children = e;
      else if (1 < f) {
        g = Array(f);
        for (var m = 0; m < f; m++) g[m] = arguments[m + 2];
        d.children = g;
      }
      return { $$typeof: l, type: a.type, key: c, ref: k, props: d, _owner: h };
    };
    exports2.createContext = function(a) {
      a = { $$typeof: u, _currentValue: a, _currentValue2: a, _threadCount: 0, Provider: null, Consumer: null, _defaultValue: null, _globalName: null };
      a.Provider = { $$typeof: t, _context: a };
      return a.Consumer = a;
    };
    exports2.createElement = M;
    exports2.createFactory = function(a) {
      var b = M.bind(null, a);
      b.type = a;
      return b;
    };
    exports2.createRef = function() {
      return { current: null };
    };
    exports2.forwardRef = function(a) {
      return { $$typeof: v, render: a };
    };
    exports2.isValidElement = O;
    exports2.lazy = function(a) {
      return { $$typeof: y, _payload: { _status: -1, _result: a }, _init: T };
    };
    exports2.memo = function(a, b) {
      return { $$typeof: x, type: a, compare: void 0 === b ? null : b };
    };
    exports2.startTransition = function(a) {
      var b = V.transition;
      V.transition = {};
      try {
        a();
      } finally {
        V.transition = b;
      }
    };
    exports2.unstable_act = X;
    exports2.useCallback = function(a, b) {
      return U.current.useCallback(a, b);
    };
    exports2.useContext = function(a) {
      return U.current.useContext(a);
    };
    exports2.useDebugValue = function() {
    };
    exports2.useDeferredValue = function(a) {
      return U.current.useDeferredValue(a);
    };
    exports2.useEffect = function(a, b) {
      return U.current.useEffect(a, b);
    };
    exports2.useId = function() {
      return U.current.useId();
    };
    exports2.useImperativeHandle = function(a, b, e) {
      return U.current.useImperativeHandle(a, b, e);
    };
    exports2.useInsertionEffect = function(a, b) {
      return U.current.useInsertionEffect(a, b);
    };
    exports2.useLayoutEffect = function(a, b) {
      return U.current.useLayoutEffect(a, b);
    };
    exports2.useMemo = function(a, b) {
      return U.current.useMemo(a, b);
    };
    exports2.useReducer = function(a, b, e) {
      return U.current.useReducer(a, b, e);
    };
    exports2.useRef = function(a) {
      return U.current.useRef(a);
    };
    exports2.useState = function(a) {
      return U.current.useState(a);
    };
    exports2.useSyncExternalStore = function(a, b, e) {
      return U.current.useSyncExternalStore(a, b, e);
    };
    exports2.useTransition = function() {
      return U.current.useTransition();
    };
    exports2.version = "18.3.1";
  }
});

// node_modules/react/cjs/react.development.js
var require_react_development = __commonJS({
  "node_modules/react/cjs/react.development.js"(exports2, module2) {
    "use strict";
    if (process.env.NODE_ENV !== "production") {
      (function() {
        "use strict";
        if (typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ !== "undefined" && typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.registerInternalModuleStart === "function") {
          __REACT_DEVTOOLS_GLOBAL_HOOK__.registerInternalModuleStart(new Error());
        }
        var ReactVersion = "18.3.1";
        var REACT_ELEMENT_TYPE = Symbol.for("react.element");
        var REACT_PORTAL_TYPE = Symbol.for("react.portal");
        var REACT_FRAGMENT_TYPE = Symbol.for("react.fragment");
        var REACT_STRICT_MODE_TYPE = Symbol.for("react.strict_mode");
        var REACT_PROFILER_TYPE = Symbol.for("react.profiler");
        var REACT_PROVIDER_TYPE = Symbol.for("react.provider");
        var REACT_CONTEXT_TYPE = Symbol.for("react.context");
        var REACT_FORWARD_REF_TYPE = Symbol.for("react.forward_ref");
        var REACT_SUSPENSE_TYPE = Symbol.for("react.suspense");
        var REACT_SUSPENSE_LIST_TYPE = Symbol.for("react.suspense_list");
        var REACT_MEMO_TYPE = Symbol.for("react.memo");
        var REACT_LAZY_TYPE = Symbol.for("react.lazy");
        var REACT_OFFSCREEN_TYPE = Symbol.for("react.offscreen");
        var MAYBE_ITERATOR_SYMBOL = Symbol.iterator;
        var FAUX_ITERATOR_SYMBOL = "@@iterator";
        function getIteratorFn(maybeIterable) {
          if (maybeIterable === null || typeof maybeIterable !== "object") {
            return null;
          }
          var maybeIterator = MAYBE_ITERATOR_SYMBOL && maybeIterable[MAYBE_ITERATOR_SYMBOL] || maybeIterable[FAUX_ITERATOR_SYMBOL];
          if (typeof maybeIterator === "function") {
            return maybeIterator;
          }
          return null;
        }
        var ReactCurrentDispatcher = {
          /**
           * @internal
           * @type {ReactComponent}
           */
          current: null
        };
        var ReactCurrentBatchConfig = {
          transition: null
        };
        var ReactCurrentActQueue = {
          current: null,
          // Used to reproduce behavior of `batchedUpdates` in legacy mode.
          isBatchingLegacy: false,
          didScheduleLegacyUpdate: false
        };
        var ReactCurrentOwner = {
          /**
           * @internal
           * @type {ReactComponent}
           */
          current: null
        };
        var ReactDebugCurrentFrame = {};
        var currentExtraStackFrame = null;
        function setExtraStackFrame(stack) {
          {
            currentExtraStackFrame = stack;
          }
        }
        {
          ReactDebugCurrentFrame.setExtraStackFrame = function(stack) {
            {
              currentExtraStackFrame = stack;
            }
          };
          ReactDebugCurrentFrame.getCurrentStack = null;
          ReactDebugCurrentFrame.getStackAddendum = function() {
            var stack = "";
            if (currentExtraStackFrame) {
              stack += currentExtraStackFrame;
            }
            var impl = ReactDebugCurrentFrame.getCurrentStack;
            if (impl) {
              stack += impl() || "";
            }
            return stack;
          };
        }
        var enableScopeAPI = false;
        var enableCacheElement = false;
        var enableTransitionTracing = false;
        var enableLegacyHidden = false;
        var enableDebugTracing = false;
        var ReactSharedInternals = {
          ReactCurrentDispatcher,
          ReactCurrentBatchConfig,
          ReactCurrentOwner
        };
        {
          ReactSharedInternals.ReactDebugCurrentFrame = ReactDebugCurrentFrame;
          ReactSharedInternals.ReactCurrentActQueue = ReactCurrentActQueue;
        }
        function warn(format) {
          {
            {
              for (var _len = arguments.length, args = new Array(_len > 1 ? _len - 1 : 0), _key = 1; _key < _len; _key++) {
                args[_key - 1] = arguments[_key];
              }
              printWarning("warn", format, args);
            }
          }
        }
        function error(format) {
          {
            {
              for (var _len2 = arguments.length, args = new Array(_len2 > 1 ? _len2 - 1 : 0), _key2 = 1; _key2 < _len2; _key2++) {
                args[_key2 - 1] = arguments[_key2];
              }
              printWarning("error", format, args);
            }
          }
        }
        function printWarning(level, format, args) {
          {
            var ReactDebugCurrentFrame2 = ReactSharedInternals.ReactDebugCurrentFrame;
            var stack = ReactDebugCurrentFrame2.getStackAddendum();
            if (stack !== "") {
              format += "%s";
              args = args.concat([stack]);
            }
            var argsWithFormat = args.map(function(item) {
              return String(item);
            });
            argsWithFormat.unshift("Warning: " + format);
            Function.prototype.apply.call(console[level], console, argsWithFormat);
          }
        }
        var didWarnStateUpdateForUnmountedComponent = {};
        function warnNoop(publicInstance, callerName) {
          {
            var _constructor = publicInstance.constructor;
            var componentName = _constructor && (_constructor.displayName || _constructor.name) || "ReactClass";
            var warningKey = componentName + "." + callerName;
            if (didWarnStateUpdateForUnmountedComponent[warningKey]) {
              return;
            }
            error("Can't call %s on a component that is not yet mounted. This is a no-op, but it might indicate a bug in your application. Instead, assign to `this.state` directly or define a `state = {};` class property with the desired state in the %s component.", callerName, componentName);
            didWarnStateUpdateForUnmountedComponent[warningKey] = true;
          }
        }
        var ReactNoopUpdateQueue = {
          /**
           * Checks whether or not this composite component is mounted.
           * @param {ReactClass} publicInstance The instance we want to test.
           * @return {boolean} True if mounted, false otherwise.
           * @protected
           * @final
           */
          isMounted: function(publicInstance) {
            return false;
          },
          /**
           * Forces an update. This should only be invoked when it is known with
           * certainty that we are **not** in a DOM transaction.
           *
           * You may want to call this when you know that some deeper aspect of the
           * component's state has changed but `setState` was not called.
           *
           * This will not invoke `shouldComponentUpdate`, but it will invoke
           * `componentWillUpdate` and `componentDidUpdate`.
           *
           * @param {ReactClass} publicInstance The instance that should rerender.
           * @param {?function} callback Called after component is updated.
           * @param {?string} callerName name of the calling function in the public API.
           * @internal
           */
          enqueueForceUpdate: function(publicInstance, callback, callerName) {
            warnNoop(publicInstance, "forceUpdate");
          },
          /**
           * Replaces all of the state. Always use this or `setState` to mutate state.
           * You should treat `this.state` as immutable.
           *
           * There is no guarantee that `this.state` will be immediately updated, so
           * accessing `this.state` after calling this method may return the old value.
           *
           * @param {ReactClass} publicInstance The instance that should rerender.
           * @param {object} completeState Next state.
           * @param {?function} callback Called after component is updated.
           * @param {?string} callerName name of the calling function in the public API.
           * @internal
           */
          enqueueReplaceState: function(publicInstance, completeState, callback, callerName) {
            warnNoop(publicInstance, "replaceState");
          },
          /**
           * Sets a subset of the state. This only exists because _pendingState is
           * internal. This provides a merging strategy that is not available to deep
           * properties which is confusing. TODO: Expose pendingState or don't use it
           * during the merge.
           *
           * @param {ReactClass} publicInstance The instance that should rerender.
           * @param {object} partialState Next partial state to be merged with state.
           * @param {?function} callback Called after component is updated.
           * @param {?string} Name of the calling function in the public API.
           * @internal
           */
          enqueueSetState: function(publicInstance, partialState, callback, callerName) {
            warnNoop(publicInstance, "setState");
          }
        };
        var assign = Object.assign;
        var emptyObject = {};
        {
          Object.freeze(emptyObject);
        }
        function Component(props, context, updater) {
          this.props = props;
          this.context = context;
          this.refs = emptyObject;
          this.updater = updater || ReactNoopUpdateQueue;
        }
        Component.prototype.isReactComponent = {};
        Component.prototype.setState = function(partialState, callback) {
          if (typeof partialState !== "object" && typeof partialState !== "function" && partialState != null) {
            throw new Error("setState(...): takes an object of state variables to update or a function which returns an object of state variables.");
          }
          this.updater.enqueueSetState(this, partialState, callback, "setState");
        };
        Component.prototype.forceUpdate = function(callback) {
          this.updater.enqueueForceUpdate(this, callback, "forceUpdate");
        };
        {
          var deprecatedAPIs = {
            isMounted: ["isMounted", "Instead, make sure to clean up subscriptions and pending requests in componentWillUnmount to prevent memory leaks."],
            replaceState: ["replaceState", "Refactor your code to use setState instead (see https://github.com/facebook/react/issues/3236)."]
          };
          var defineDeprecationWarning = function(methodName, info) {
            Object.defineProperty(Component.prototype, methodName, {
              get: function() {
                warn("%s(...) is deprecated in plain JavaScript React classes. %s", info[0], info[1]);
                return void 0;
              }
            });
          };
          for (var fnName in deprecatedAPIs) {
            if (deprecatedAPIs.hasOwnProperty(fnName)) {
              defineDeprecationWarning(fnName, deprecatedAPIs[fnName]);
            }
          }
        }
        function ComponentDummy() {
        }
        ComponentDummy.prototype = Component.prototype;
        function PureComponent(props, context, updater) {
          this.props = props;
          this.context = context;
          this.refs = emptyObject;
          this.updater = updater || ReactNoopUpdateQueue;
        }
        var pureComponentPrototype = PureComponent.prototype = new ComponentDummy();
        pureComponentPrototype.constructor = PureComponent;
        assign(pureComponentPrototype, Component.prototype);
        pureComponentPrototype.isPureReactComponent = true;
        function createRef() {
          var refObject = {
            current: null
          };
          {
            Object.seal(refObject);
          }
          return refObject;
        }
        var isArrayImpl = Array.isArray;
        function isArray(a) {
          return isArrayImpl(a);
        }
        function typeName(value) {
          {
            var hasToStringTag = typeof Symbol === "function" && Symbol.toStringTag;
            var type = hasToStringTag && value[Symbol.toStringTag] || value.constructor.name || "Object";
            return type;
          }
        }
        function willCoercionThrow(value) {
          {
            try {
              testStringCoercion(value);
              return false;
            } catch (e) {
              return true;
            }
          }
        }
        function testStringCoercion(value) {
          return "" + value;
        }
        function checkKeyStringCoercion(value) {
          {
            if (willCoercionThrow(value)) {
              error("The provided key is an unsupported type %s. This value must be coerced to a string before before using it here.", typeName(value));
              return testStringCoercion(value);
            }
          }
        }
        function getWrappedName(outerType, innerType, wrapperName) {
          var displayName = outerType.displayName;
          if (displayName) {
            return displayName;
          }
          var functionName = innerType.displayName || innerType.name || "";
          return functionName !== "" ? wrapperName + "(" + functionName + ")" : wrapperName;
        }
        function getContextName(type) {
          return type.displayName || "Context";
        }
        function getComponentNameFromType(type) {
          if (type == null) {
            return null;
          }
          {
            if (typeof type.tag === "number") {
              error("Received an unexpected object in getComponentNameFromType(). This is likely a bug in React. Please file an issue.");
            }
          }
          if (typeof type === "function") {
            return type.displayName || type.name || null;
          }
          if (typeof type === "string") {
            return type;
          }
          switch (type) {
            case REACT_FRAGMENT_TYPE:
              return "Fragment";
            case REACT_PORTAL_TYPE:
              return "Portal";
            case REACT_PROFILER_TYPE:
              return "Profiler";
            case REACT_STRICT_MODE_TYPE:
              return "StrictMode";
            case REACT_SUSPENSE_TYPE:
              return "Suspense";
            case REACT_SUSPENSE_LIST_TYPE:
              return "SuspenseList";
          }
          if (typeof type === "object") {
            switch (type.$$typeof) {
              case REACT_CONTEXT_TYPE:
                var context = type;
                return getContextName(context) + ".Consumer";
              case REACT_PROVIDER_TYPE:
                var provider = type;
                return getContextName(provider._context) + ".Provider";
              case REACT_FORWARD_REF_TYPE:
                return getWrappedName(type, type.render, "ForwardRef");
              case REACT_MEMO_TYPE:
                var outerName = type.displayName || null;
                if (outerName !== null) {
                  return outerName;
                }
                return getComponentNameFromType(type.type) || "Memo";
              case REACT_LAZY_TYPE: {
                var lazyComponent = type;
                var payload = lazyComponent._payload;
                var init = lazyComponent._init;
                try {
                  return getComponentNameFromType(init(payload));
                } catch (x) {
                  return null;
                }
              }
            }
          }
          return null;
        }
        var hasOwnProperty = Object.prototype.hasOwnProperty;
        var RESERVED_PROPS = {
          key: true,
          ref: true,
          __self: true,
          __source: true
        };
        var specialPropKeyWarningShown, specialPropRefWarningShown, didWarnAboutStringRefs;
        {
          didWarnAboutStringRefs = {};
        }
        function hasValidRef(config) {
          {
            if (hasOwnProperty.call(config, "ref")) {
              var getter = Object.getOwnPropertyDescriptor(config, "ref").get;
              if (getter && getter.isReactWarning) {
                return false;
              }
            }
          }
          return config.ref !== void 0;
        }
        function hasValidKey(config) {
          {
            if (hasOwnProperty.call(config, "key")) {
              var getter = Object.getOwnPropertyDescriptor(config, "key").get;
              if (getter && getter.isReactWarning) {
                return false;
              }
            }
          }
          return config.key !== void 0;
        }
        function defineKeyPropWarningGetter(props, displayName) {
          var warnAboutAccessingKey = function() {
            {
              if (!specialPropKeyWarningShown) {
                specialPropKeyWarningShown = true;
                error("%s: `key` is not a prop. Trying to access it will result in `undefined` being returned. If you need to access the same value within the child component, you should pass it as a different prop. (https://reactjs.org/link/special-props)", displayName);
              }
            }
          };
          warnAboutAccessingKey.isReactWarning = true;
          Object.defineProperty(props, "key", {
            get: warnAboutAccessingKey,
            configurable: true
          });
        }
        function defineRefPropWarningGetter(props, displayName) {
          var warnAboutAccessingRef = function() {
            {
              if (!specialPropRefWarningShown) {
                specialPropRefWarningShown = true;
                error("%s: `ref` is not a prop. Trying to access it will result in `undefined` being returned. If you need to access the same value within the child component, you should pass it as a different prop. (https://reactjs.org/link/special-props)", displayName);
              }
            }
          };
          warnAboutAccessingRef.isReactWarning = true;
          Object.defineProperty(props, "ref", {
            get: warnAboutAccessingRef,
            configurable: true
          });
        }
        function warnIfStringRefCannotBeAutoConverted(config) {
          {
            if (typeof config.ref === "string" && ReactCurrentOwner.current && config.__self && ReactCurrentOwner.current.stateNode !== config.__self) {
              var componentName = getComponentNameFromType(ReactCurrentOwner.current.type);
              if (!didWarnAboutStringRefs[componentName]) {
                error('Component "%s" contains the string ref "%s". Support for string refs will be removed in a future major release. This case cannot be automatically converted to an arrow function. We ask you to manually fix this case by using useRef() or createRef() instead. Learn more about using refs safely here: https://reactjs.org/link/strict-mode-string-ref', componentName, config.ref);
                didWarnAboutStringRefs[componentName] = true;
              }
            }
          }
        }
        var ReactElement = function(type, key, ref, self, source, owner, props) {
          var element = {
            // This tag allows us to uniquely identify this as a React Element
            $$typeof: REACT_ELEMENT_TYPE,
            // Built-in properties that belong on the element
            type,
            key,
            ref,
            props,
            // Record the component responsible for creating this element.
            _owner: owner
          };
          {
            element._store = {};
            Object.defineProperty(element._store, "validated", {
              configurable: false,
              enumerable: false,
              writable: true,
              value: false
            });
            Object.defineProperty(element, "_self", {
              configurable: false,
              enumerable: false,
              writable: false,
              value: self
            });
            Object.defineProperty(element, "_source", {
              configurable: false,
              enumerable: false,
              writable: false,
              value: source
            });
            if (Object.freeze) {
              Object.freeze(element.props);
              Object.freeze(element);
            }
          }
          return element;
        };
        function createElement(type, config, children) {
          var propName;
          var props = {};
          var key = null;
          var ref = null;
          var self = null;
          var source = null;
          if (config != null) {
            if (hasValidRef(config)) {
              ref = config.ref;
              {
                warnIfStringRefCannotBeAutoConverted(config);
              }
            }
            if (hasValidKey(config)) {
              {
                checkKeyStringCoercion(config.key);
              }
              key = "" + config.key;
            }
            self = config.__self === void 0 ? null : config.__self;
            source = config.__source === void 0 ? null : config.__source;
            for (propName in config) {
              if (hasOwnProperty.call(config, propName) && !RESERVED_PROPS.hasOwnProperty(propName)) {
                props[propName] = config[propName];
              }
            }
          }
          var childrenLength = arguments.length - 2;
          if (childrenLength === 1) {
            props.children = children;
          } else if (childrenLength > 1) {
            var childArray = Array(childrenLength);
            for (var i = 0; i < childrenLength; i++) {
              childArray[i] = arguments[i + 2];
            }
            {
              if (Object.freeze) {
                Object.freeze(childArray);
              }
            }
            props.children = childArray;
          }
          if (type && type.defaultProps) {
            var defaultProps = type.defaultProps;
            for (propName in defaultProps) {
              if (props[propName] === void 0) {
                props[propName] = defaultProps[propName];
              }
            }
          }
          {
            if (key || ref) {
              var displayName = typeof type === "function" ? type.displayName || type.name || "Unknown" : type;
              if (key) {
                defineKeyPropWarningGetter(props, displayName);
              }
              if (ref) {
                defineRefPropWarningGetter(props, displayName);
              }
            }
          }
          return ReactElement(type, key, ref, self, source, ReactCurrentOwner.current, props);
        }
        function cloneAndReplaceKey(oldElement, newKey) {
          var newElement = ReactElement(oldElement.type, newKey, oldElement.ref, oldElement._self, oldElement._source, oldElement._owner, oldElement.props);
          return newElement;
        }
        function cloneElement(element, config, children) {
          if (element === null || element === void 0) {
            throw new Error("React.cloneElement(...): The argument must be a React element, but you passed " + element + ".");
          }
          var propName;
          var props = assign({}, element.props);
          var key = element.key;
          var ref = element.ref;
          var self = element._self;
          var source = element._source;
          var owner = element._owner;
          if (config != null) {
            if (hasValidRef(config)) {
              ref = config.ref;
              owner = ReactCurrentOwner.current;
            }
            if (hasValidKey(config)) {
              {
                checkKeyStringCoercion(config.key);
              }
              key = "" + config.key;
            }
            var defaultProps;
            if (element.type && element.type.defaultProps) {
              defaultProps = element.type.defaultProps;
            }
            for (propName in config) {
              if (hasOwnProperty.call(config, propName) && !RESERVED_PROPS.hasOwnProperty(propName)) {
                if (config[propName] === void 0 && defaultProps !== void 0) {
                  props[propName] = defaultProps[propName];
                } else {
                  props[propName] = config[propName];
                }
              }
            }
          }
          var childrenLength = arguments.length - 2;
          if (childrenLength === 1) {
            props.children = children;
          } else if (childrenLength > 1) {
            var childArray = Array(childrenLength);
            for (var i = 0; i < childrenLength; i++) {
              childArray[i] = arguments[i + 2];
            }
            props.children = childArray;
          }
          return ReactElement(element.type, key, ref, self, source, owner, props);
        }
        function isValidElement(object) {
          return typeof object === "object" && object !== null && object.$$typeof === REACT_ELEMENT_TYPE;
        }
        var SEPARATOR = ".";
        var SUBSEPARATOR = ":";
        function escape(key) {
          var escapeRegex = /[=:]/g;
          var escaperLookup = {
            "=": "=0",
            ":": "=2"
          };
          var escapedString = key.replace(escapeRegex, function(match) {
            return escaperLookup[match];
          });
          return "$" + escapedString;
        }
        var didWarnAboutMaps = false;
        var userProvidedKeyEscapeRegex = /\/+/g;
        function escapeUserProvidedKey(text) {
          return text.replace(userProvidedKeyEscapeRegex, "$&/");
        }
        function getElementKey(element, index) {
          if (typeof element === "object" && element !== null && element.key != null) {
            {
              checkKeyStringCoercion(element.key);
            }
            return escape("" + element.key);
          }
          return index.toString(36);
        }
        function mapIntoArray(children, array, escapedPrefix, nameSoFar, callback) {
          var type = typeof children;
          if (type === "undefined" || type === "boolean") {
            children = null;
          }
          var invokeCallback = false;
          if (children === null) {
            invokeCallback = true;
          } else {
            switch (type) {
              case "string":
              case "number":
                invokeCallback = true;
                break;
              case "object":
                switch (children.$$typeof) {
                  case REACT_ELEMENT_TYPE:
                  case REACT_PORTAL_TYPE:
                    invokeCallback = true;
                }
            }
          }
          if (invokeCallback) {
            var _child = children;
            var mappedChild = callback(_child);
            var childKey = nameSoFar === "" ? SEPARATOR + getElementKey(_child, 0) : nameSoFar;
            if (isArray(mappedChild)) {
              var escapedChildKey = "";
              if (childKey != null) {
                escapedChildKey = escapeUserProvidedKey(childKey) + "/";
              }
              mapIntoArray(mappedChild, array, escapedChildKey, "", function(c) {
                return c;
              });
            } else if (mappedChild != null) {
              if (isValidElement(mappedChild)) {
                {
                  if (mappedChild.key && (!_child || _child.key !== mappedChild.key)) {
                    checkKeyStringCoercion(mappedChild.key);
                  }
                }
                mappedChild = cloneAndReplaceKey(
                  mappedChild,
                  // Keep both the (mapped) and old keys if they differ, just as
                  // traverseAllChildren used to do for objects as children
                  escapedPrefix + // $FlowFixMe Flow incorrectly thinks React.Portal doesn't have a key
                  (mappedChild.key && (!_child || _child.key !== mappedChild.key) ? (
                    // $FlowFixMe Flow incorrectly thinks existing element's key can be a number
                    // eslint-disable-next-line react-internal/safe-string-coercion
                    escapeUserProvidedKey("" + mappedChild.key) + "/"
                  ) : "") + childKey
                );
              }
              array.push(mappedChild);
            }
            return 1;
          }
          var child;
          var nextName;
          var subtreeCount = 0;
          var nextNamePrefix = nameSoFar === "" ? SEPARATOR : nameSoFar + SUBSEPARATOR;
          if (isArray(children)) {
            for (var i = 0; i < children.length; i++) {
              child = children[i];
              nextName = nextNamePrefix + getElementKey(child, i);
              subtreeCount += mapIntoArray(child, array, escapedPrefix, nextName, callback);
            }
          } else {
            var iteratorFn = getIteratorFn(children);
            if (typeof iteratorFn === "function") {
              var iterableChildren = children;
              {
                if (iteratorFn === iterableChildren.entries) {
                  if (!didWarnAboutMaps) {
                    warn("Using Maps as children is not supported. Use an array of keyed ReactElements instead.");
                  }
                  didWarnAboutMaps = true;
                }
              }
              var iterator = iteratorFn.call(iterableChildren);
              var step;
              var ii = 0;
              while (!(step = iterator.next()).done) {
                child = step.value;
                nextName = nextNamePrefix + getElementKey(child, ii++);
                subtreeCount += mapIntoArray(child, array, escapedPrefix, nextName, callback);
              }
            } else if (type === "object") {
              var childrenString = String(children);
              throw new Error("Objects are not valid as a React child (found: " + (childrenString === "[object Object]" ? "object with keys {" + Object.keys(children).join(", ") + "}" : childrenString) + "). If you meant to render a collection of children, use an array instead.");
            }
          }
          return subtreeCount;
        }
        function mapChildren(children, func, context) {
          if (children == null) {
            return children;
          }
          var result = [];
          var count = 0;
          mapIntoArray(children, result, "", "", function(child) {
            return func.call(context, child, count++);
          });
          return result;
        }
        function countChildren(children) {
          var n = 0;
          mapChildren(children, function() {
            n++;
          });
          return n;
        }
        function forEachChildren(children, forEachFunc, forEachContext) {
          mapChildren(children, function() {
            forEachFunc.apply(this, arguments);
          }, forEachContext);
        }
        function toArray(children) {
          return mapChildren(children, function(child) {
            return child;
          }) || [];
        }
        function onlyChild(children) {
          if (!isValidElement(children)) {
            throw new Error("React.Children.only expected to receive a single React element child.");
          }
          return children;
        }
        function createContext(defaultValue) {
          var context = {
            $$typeof: REACT_CONTEXT_TYPE,
            // As a workaround to support multiple concurrent renderers, we categorize
            // some renderers as primary and others as secondary. We only expect
            // there to be two concurrent renderers at most: React Native (primary) and
            // Fabric (secondary); React DOM (primary) and React ART (secondary).
            // Secondary renderers store their context values on separate fields.
            _currentValue: defaultValue,
            _currentValue2: defaultValue,
            // Used to track how many concurrent renderers this context currently
            // supports within in a single renderer. Such as parallel server rendering.
            _threadCount: 0,
            // These are circular
            Provider: null,
            Consumer: null,
            // Add these to use same hidden class in VM as ServerContext
            _defaultValue: null,
            _globalName: null
          };
          context.Provider = {
            $$typeof: REACT_PROVIDER_TYPE,
            _context: context
          };
          var hasWarnedAboutUsingNestedContextConsumers = false;
          var hasWarnedAboutUsingConsumerProvider = false;
          var hasWarnedAboutDisplayNameOnConsumer = false;
          {
            var Consumer = {
              $$typeof: REACT_CONTEXT_TYPE,
              _context: context
            };
            Object.defineProperties(Consumer, {
              Provider: {
                get: function() {
                  if (!hasWarnedAboutUsingConsumerProvider) {
                    hasWarnedAboutUsingConsumerProvider = true;
                    error("Rendering <Context.Consumer.Provider> is not supported and will be removed in a future major release. Did you mean to render <Context.Provider> instead?");
                  }
                  return context.Provider;
                },
                set: function(_Provider) {
                  context.Provider = _Provider;
                }
              },
              _currentValue: {
                get: function() {
                  return context._currentValue;
                },
                set: function(_currentValue) {
                  context._currentValue = _currentValue;
                }
              },
              _currentValue2: {
                get: function() {
                  return context._currentValue2;
                },
                set: function(_currentValue2) {
                  context._currentValue2 = _currentValue2;
                }
              },
              _threadCount: {
                get: function() {
                  return context._threadCount;
                },
                set: function(_threadCount) {
                  context._threadCount = _threadCount;
                }
              },
              Consumer: {
                get: function() {
                  if (!hasWarnedAboutUsingNestedContextConsumers) {
                    hasWarnedAboutUsingNestedContextConsumers = true;
                    error("Rendering <Context.Consumer.Consumer> is not supported and will be removed in a future major release. Did you mean to render <Context.Consumer> instead?");
                  }
                  return context.Consumer;
                }
              },
              displayName: {
                get: function() {
                  return context.displayName;
                },
                set: function(displayName) {
                  if (!hasWarnedAboutDisplayNameOnConsumer) {
                    warn("Setting `displayName` on Context.Consumer has no effect. You should set it directly on the context with Context.displayName = '%s'.", displayName);
                    hasWarnedAboutDisplayNameOnConsumer = true;
                  }
                }
              }
            });
            context.Consumer = Consumer;
          }
          {
            context._currentRenderer = null;
            context._currentRenderer2 = null;
          }
          return context;
        }
        var Uninitialized = -1;
        var Pending = 0;
        var Resolved = 1;
        var Rejected = 2;
        function lazyInitializer(payload) {
          if (payload._status === Uninitialized) {
            var ctor = payload._result;
            var thenable = ctor();
            thenable.then(function(moduleObject2) {
              if (payload._status === Pending || payload._status === Uninitialized) {
                var resolved = payload;
                resolved._status = Resolved;
                resolved._result = moduleObject2;
              }
            }, function(error2) {
              if (payload._status === Pending || payload._status === Uninitialized) {
                var rejected = payload;
                rejected._status = Rejected;
                rejected._result = error2;
              }
            });
            if (payload._status === Uninitialized) {
              var pending = payload;
              pending._status = Pending;
              pending._result = thenable;
            }
          }
          if (payload._status === Resolved) {
            var moduleObject = payload._result;
            {
              if (moduleObject === void 0) {
                error("lazy: Expected the result of a dynamic import() call. Instead received: %s\n\nYour code should look like: \n  const MyComponent = lazy(() => import('./MyComponent'))\n\nDid you accidentally put curly braces around the import?", moduleObject);
              }
            }
            {
              if (!("default" in moduleObject)) {
                error("lazy: Expected the result of a dynamic import() call. Instead received: %s\n\nYour code should look like: \n  const MyComponent = lazy(() => import('./MyComponent'))", moduleObject);
              }
            }
            return moduleObject.default;
          } else {
            throw payload._result;
          }
        }
        function lazy(ctor) {
          var payload = {
            // We use these fields to store the result.
            _status: Uninitialized,
            _result: ctor
          };
          var lazyType = {
            $$typeof: REACT_LAZY_TYPE,
            _payload: payload,
            _init: lazyInitializer
          };
          {
            var defaultProps;
            var propTypes;
            Object.defineProperties(lazyType, {
              defaultProps: {
                configurable: true,
                get: function() {
                  return defaultProps;
                },
                set: function(newDefaultProps) {
                  error("React.lazy(...): It is not supported to assign `defaultProps` to a lazy component import. Either specify them where the component is defined, or create a wrapping component around it.");
                  defaultProps = newDefaultProps;
                  Object.defineProperty(lazyType, "defaultProps", {
                    enumerable: true
                  });
                }
              },
              propTypes: {
                configurable: true,
                get: function() {
                  return propTypes;
                },
                set: function(newPropTypes) {
                  error("React.lazy(...): It is not supported to assign `propTypes` to a lazy component import. Either specify them where the component is defined, or create a wrapping component around it.");
                  propTypes = newPropTypes;
                  Object.defineProperty(lazyType, "propTypes", {
                    enumerable: true
                  });
                }
              }
            });
          }
          return lazyType;
        }
        function forwardRef(render) {
          {
            if (render != null && render.$$typeof === REACT_MEMO_TYPE) {
              error("forwardRef requires a render function but received a `memo` component. Instead of forwardRef(memo(...)), use memo(forwardRef(...)).");
            } else if (typeof render !== "function") {
              error("forwardRef requires a render function but was given %s.", render === null ? "null" : typeof render);
            } else {
              if (render.length !== 0 && render.length !== 2) {
                error("forwardRef render functions accept exactly two parameters: props and ref. %s", render.length === 1 ? "Did you forget to use the ref parameter?" : "Any additional parameter will be undefined.");
              }
            }
            if (render != null) {
              if (render.defaultProps != null || render.propTypes != null) {
                error("forwardRef render functions do not support propTypes or defaultProps. Did you accidentally pass a React component?");
              }
            }
          }
          var elementType = {
            $$typeof: REACT_FORWARD_REF_TYPE,
            render
          };
          {
            var ownName;
            Object.defineProperty(elementType, "displayName", {
              enumerable: false,
              configurable: true,
              get: function() {
                return ownName;
              },
              set: function(name) {
                ownName = name;
                if (!render.name && !render.displayName) {
                  render.displayName = name;
                }
              }
            });
          }
          return elementType;
        }
        var REACT_MODULE_REFERENCE;
        {
          REACT_MODULE_REFERENCE = Symbol.for("react.module.reference");
        }
        function isValidElementType(type) {
          if (typeof type === "string" || typeof type === "function") {
            return true;
          }
          if (type === REACT_FRAGMENT_TYPE || type === REACT_PROFILER_TYPE || enableDebugTracing || type === REACT_STRICT_MODE_TYPE || type === REACT_SUSPENSE_TYPE || type === REACT_SUSPENSE_LIST_TYPE || enableLegacyHidden || type === REACT_OFFSCREEN_TYPE || enableScopeAPI || enableCacheElement || enableTransitionTracing) {
            return true;
          }
          if (typeof type === "object" && type !== null) {
            if (type.$$typeof === REACT_LAZY_TYPE || type.$$typeof === REACT_MEMO_TYPE || type.$$typeof === REACT_PROVIDER_TYPE || type.$$typeof === REACT_CONTEXT_TYPE || type.$$typeof === REACT_FORWARD_REF_TYPE || // This needs to include all possible module reference object
            // types supported by any Flight configuration anywhere since
            // we don't know which Flight build this will end up being used
            // with.
            type.$$typeof === REACT_MODULE_REFERENCE || type.getModuleId !== void 0) {
              return true;
            }
          }
          return false;
        }
        function memo(type, compare) {
          {
            if (!isValidElementType(type)) {
              error("memo: The first argument must be a component. Instead received: %s", type === null ? "null" : typeof type);
            }
          }
          var elementType = {
            $$typeof: REACT_MEMO_TYPE,
            type,
            compare: compare === void 0 ? null : compare
          };
          {
            var ownName;
            Object.defineProperty(elementType, "displayName", {
              enumerable: false,
              configurable: true,
              get: function() {
                return ownName;
              },
              set: function(name) {
                ownName = name;
                if (!type.name && !type.displayName) {
                  type.displayName = name;
                }
              }
            });
          }
          return elementType;
        }
        function resolveDispatcher() {
          var dispatcher = ReactCurrentDispatcher.current;
          {
            if (dispatcher === null) {
              error("Invalid hook call. Hooks can only be called inside of the body of a function component. This could happen for one of the following reasons:\n1. You might have mismatching versions of React and the renderer (such as React DOM)\n2. You might be breaking the Rules of Hooks\n3. You might have more than one copy of React in the same app\nSee https://reactjs.org/link/invalid-hook-call for tips about how to debug and fix this problem.");
            }
          }
          return dispatcher;
        }
        function useContext(Context) {
          var dispatcher = resolveDispatcher();
          {
            if (Context._context !== void 0) {
              var realContext = Context._context;
              if (realContext.Consumer === Context) {
                error("Calling useContext(Context.Consumer) is not supported, may cause bugs, and will be removed in a future major release. Did you mean to call useContext(Context) instead?");
              } else if (realContext.Provider === Context) {
                error("Calling useContext(Context.Provider) is not supported. Did you mean to call useContext(Context) instead?");
              }
            }
          }
          return dispatcher.useContext(Context);
        }
        function useState(initialState) {
          var dispatcher = resolveDispatcher();
          return dispatcher.useState(initialState);
        }
        function useReducer(reducer, initialArg, init) {
          var dispatcher = resolveDispatcher();
          return dispatcher.useReducer(reducer, initialArg, init);
        }
        function useRef2(initialValue) {
          var dispatcher = resolveDispatcher();
          return dispatcher.useRef(initialValue);
        }
        function useEffect2(create2, deps) {
          var dispatcher = resolveDispatcher();
          return dispatcher.useEffect(create2, deps);
        }
        function useInsertionEffect(create2, deps) {
          var dispatcher = resolveDispatcher();
          return dispatcher.useInsertionEffect(create2, deps);
        }
        function useLayoutEffect(create2, deps) {
          var dispatcher = resolveDispatcher();
          return dispatcher.useLayoutEffect(create2, deps);
        }
        function useCallback(callback, deps) {
          var dispatcher = resolveDispatcher();
          return dispatcher.useCallback(callback, deps);
        }
        function useMemo(create2, deps) {
          var dispatcher = resolveDispatcher();
          return dispatcher.useMemo(create2, deps);
        }
        function useImperativeHandle(ref, create2, deps) {
          var dispatcher = resolveDispatcher();
          return dispatcher.useImperativeHandle(ref, create2, deps);
        }
        function useDebugValue2(value, formatterFn) {
          {
            var dispatcher = resolveDispatcher();
            return dispatcher.useDebugValue(value, formatterFn);
          }
        }
        function useTransition() {
          var dispatcher = resolveDispatcher();
          return dispatcher.useTransition();
        }
        function useDeferredValue(value) {
          var dispatcher = resolveDispatcher();
          return dispatcher.useDeferredValue(value);
        }
        function useId() {
          var dispatcher = resolveDispatcher();
          return dispatcher.useId();
        }
        function useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot) {
          var dispatcher = resolveDispatcher();
          return dispatcher.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
        }
        var disabledDepth = 0;
        var prevLog;
        var prevInfo;
        var prevWarn;
        var prevError;
        var prevGroup;
        var prevGroupCollapsed;
        var prevGroupEnd;
        function disabledLog() {
        }
        disabledLog.__reactDisabledLog = true;
        function disableLogs() {
          {
            if (disabledDepth === 0) {
              prevLog = console.log;
              prevInfo = console.info;
              prevWarn = console.warn;
              prevError = console.error;
              prevGroup = console.group;
              prevGroupCollapsed = console.groupCollapsed;
              prevGroupEnd = console.groupEnd;
              var props = {
                configurable: true,
                enumerable: true,
                value: disabledLog,
                writable: true
              };
              Object.defineProperties(console, {
                info: props,
                log: props,
                warn: props,
                error: props,
                group: props,
                groupCollapsed: props,
                groupEnd: props
              });
            }
            disabledDepth++;
          }
        }
        function reenableLogs() {
          {
            disabledDepth--;
            if (disabledDepth === 0) {
              var props = {
                configurable: true,
                enumerable: true,
                writable: true
              };
              Object.defineProperties(console, {
                log: assign({}, props, {
                  value: prevLog
                }),
                info: assign({}, props, {
                  value: prevInfo
                }),
                warn: assign({}, props, {
                  value: prevWarn
                }),
                error: assign({}, props, {
                  value: prevError
                }),
                group: assign({}, props, {
                  value: prevGroup
                }),
                groupCollapsed: assign({}, props, {
                  value: prevGroupCollapsed
                }),
                groupEnd: assign({}, props, {
                  value: prevGroupEnd
                })
              });
            }
            if (disabledDepth < 0) {
              error("disabledDepth fell below zero. This is a bug in React. Please file an issue.");
            }
          }
        }
        var ReactCurrentDispatcher$1 = ReactSharedInternals.ReactCurrentDispatcher;
        var prefix;
        function describeBuiltInComponentFrame(name, source, ownerFn) {
          {
            if (prefix === void 0) {
              try {
                throw Error();
              } catch (x) {
                var match = x.stack.trim().match(/\n( *(at )?)/);
                prefix = match && match[1] || "";
              }
            }
            return "\n" + prefix + name;
          }
        }
        var reentry = false;
        var componentFrameCache;
        {
          var PossiblyWeakMap = typeof WeakMap === "function" ? WeakMap : Map;
          componentFrameCache = new PossiblyWeakMap();
        }
        function describeNativeComponentFrame(fn, construct) {
          if (!fn || reentry) {
            return "";
          }
          {
            var frame = componentFrameCache.get(fn);
            if (frame !== void 0) {
              return frame;
            }
          }
          var control;
          reentry = true;
          var previousPrepareStackTrace = Error.prepareStackTrace;
          Error.prepareStackTrace = void 0;
          var previousDispatcher;
          {
            previousDispatcher = ReactCurrentDispatcher$1.current;
            ReactCurrentDispatcher$1.current = null;
            disableLogs();
          }
          try {
            if (construct) {
              var Fake = function() {
                throw Error();
              };
              Object.defineProperty(Fake.prototype, "props", {
                set: function() {
                  throw Error();
                }
              });
              if (typeof Reflect === "object" && Reflect.construct) {
                try {
                  Reflect.construct(Fake, []);
                } catch (x) {
                  control = x;
                }
                Reflect.construct(fn, [], Fake);
              } else {
                try {
                  Fake.call();
                } catch (x) {
                  control = x;
                }
                fn.call(Fake.prototype);
              }
            } else {
              try {
                throw Error();
              } catch (x) {
                control = x;
              }
              fn();
            }
          } catch (sample) {
            if (sample && control && typeof sample.stack === "string") {
              var sampleLines = sample.stack.split("\n");
              var controlLines = control.stack.split("\n");
              var s = sampleLines.length - 1;
              var c = controlLines.length - 1;
              while (s >= 1 && c >= 0 && sampleLines[s] !== controlLines[c]) {
                c--;
              }
              for (; s >= 1 && c >= 0; s--, c--) {
                if (sampleLines[s] !== controlLines[c]) {
                  if (s !== 1 || c !== 1) {
                    do {
                      s--;
                      c--;
                      if (c < 0 || sampleLines[s] !== controlLines[c]) {
                        var _frame = "\n" + sampleLines[s].replace(" at new ", " at ");
                        if (fn.displayName && _frame.includes("<anonymous>")) {
                          _frame = _frame.replace("<anonymous>", fn.displayName);
                        }
                        {
                          if (typeof fn === "function") {
                            componentFrameCache.set(fn, _frame);
                          }
                        }
                        return _frame;
                      }
                    } while (s >= 1 && c >= 0);
                  }
                  break;
                }
              }
            }
          } finally {
            reentry = false;
            {
              ReactCurrentDispatcher$1.current = previousDispatcher;
              reenableLogs();
            }
            Error.prepareStackTrace = previousPrepareStackTrace;
          }
          var name = fn ? fn.displayName || fn.name : "";
          var syntheticFrame = name ? describeBuiltInComponentFrame(name) : "";
          {
            if (typeof fn === "function") {
              componentFrameCache.set(fn, syntheticFrame);
            }
          }
          return syntheticFrame;
        }
        function describeFunctionComponentFrame(fn, source, ownerFn) {
          {
            return describeNativeComponentFrame(fn, false);
          }
        }
        function shouldConstruct(Component2) {
          var prototype = Component2.prototype;
          return !!(prototype && prototype.isReactComponent);
        }
        function describeUnknownElementTypeFrameInDEV(type, source, ownerFn) {
          if (type == null) {
            return "";
          }
          if (typeof type === "function") {
            {
              return describeNativeComponentFrame(type, shouldConstruct(type));
            }
          }
          if (typeof type === "string") {
            return describeBuiltInComponentFrame(type);
          }
          switch (type) {
            case REACT_SUSPENSE_TYPE:
              return describeBuiltInComponentFrame("Suspense");
            case REACT_SUSPENSE_LIST_TYPE:
              return describeBuiltInComponentFrame("SuspenseList");
          }
          if (typeof type === "object") {
            switch (type.$$typeof) {
              case REACT_FORWARD_REF_TYPE:
                return describeFunctionComponentFrame(type.render);
              case REACT_MEMO_TYPE:
                return describeUnknownElementTypeFrameInDEV(type.type, source, ownerFn);
              case REACT_LAZY_TYPE: {
                var lazyComponent = type;
                var payload = lazyComponent._payload;
                var init = lazyComponent._init;
                try {
                  return describeUnknownElementTypeFrameInDEV(init(payload), source, ownerFn);
                } catch (x) {
                }
              }
            }
          }
          return "";
        }
        var loggedTypeFailures = {};
        var ReactDebugCurrentFrame$1 = ReactSharedInternals.ReactDebugCurrentFrame;
        function setCurrentlyValidatingElement(element) {
          {
            if (element) {
              var owner = element._owner;
              var stack = describeUnknownElementTypeFrameInDEV(element.type, element._source, owner ? owner.type : null);
              ReactDebugCurrentFrame$1.setExtraStackFrame(stack);
            } else {
              ReactDebugCurrentFrame$1.setExtraStackFrame(null);
            }
          }
        }
        function checkPropTypes(typeSpecs, values, location, componentName, element) {
          {
            var has = Function.call.bind(hasOwnProperty);
            for (var typeSpecName in typeSpecs) {
              if (has(typeSpecs, typeSpecName)) {
                var error$1 = void 0;
                try {
                  if (typeof typeSpecs[typeSpecName] !== "function") {
                    var err = Error((componentName || "React class") + ": " + location + " type `" + typeSpecName + "` is invalid; it must be a function, usually from the `prop-types` package, but received `" + typeof typeSpecs[typeSpecName] + "`.This often happens because of typos such as `PropTypes.function` instead of `PropTypes.func`.");
                    err.name = "Invariant Violation";
                    throw err;
                  }
                  error$1 = typeSpecs[typeSpecName](values, typeSpecName, componentName, location, null, "SECRET_DO_NOT_PASS_THIS_OR_YOU_WILL_BE_FIRED");
                } catch (ex) {
                  error$1 = ex;
                }
                if (error$1 && !(error$1 instanceof Error)) {
                  setCurrentlyValidatingElement(element);
                  error("%s: type specification of %s `%s` is invalid; the type checker function must return `null` or an `Error` but returned a %s. You may have forgotten to pass an argument to the type checker creator (arrayOf, instanceOf, objectOf, oneOf, oneOfType, and shape all require an argument).", componentName || "React class", location, typeSpecName, typeof error$1);
                  setCurrentlyValidatingElement(null);
                }
                if (error$1 instanceof Error && !(error$1.message in loggedTypeFailures)) {
                  loggedTypeFailures[error$1.message] = true;
                  setCurrentlyValidatingElement(element);
                  error("Failed %s type: %s", location, error$1.message);
                  setCurrentlyValidatingElement(null);
                }
              }
            }
          }
        }
        function setCurrentlyValidatingElement$1(element) {
          {
            if (element) {
              var owner = element._owner;
              var stack = describeUnknownElementTypeFrameInDEV(element.type, element._source, owner ? owner.type : null);
              setExtraStackFrame(stack);
            } else {
              setExtraStackFrame(null);
            }
          }
        }
        var propTypesMisspellWarningShown;
        {
          propTypesMisspellWarningShown = false;
        }
        function getDeclarationErrorAddendum() {
          if (ReactCurrentOwner.current) {
            var name = getComponentNameFromType(ReactCurrentOwner.current.type);
            if (name) {
              return "\n\nCheck the render method of `" + name + "`.";
            }
          }
          return "";
        }
        function getSourceInfoErrorAddendum(source) {
          if (source !== void 0) {
            var fileName = source.fileName.replace(/^.*[\\\/]/, "");
            var lineNumber = source.lineNumber;
            return "\n\nCheck your code at " + fileName + ":" + lineNumber + ".";
          }
          return "";
        }
        function getSourceInfoErrorAddendumForProps(elementProps) {
          if (elementProps !== null && elementProps !== void 0) {
            return getSourceInfoErrorAddendum(elementProps.__source);
          }
          return "";
        }
        var ownerHasKeyUseWarning = {};
        function getCurrentComponentErrorInfo(parentType) {
          var info = getDeclarationErrorAddendum();
          if (!info) {
            var parentName = typeof parentType === "string" ? parentType : parentType.displayName || parentType.name;
            if (parentName) {
              info = "\n\nCheck the top-level render call using <" + parentName + ">.";
            }
          }
          return info;
        }
        function validateExplicitKey(element, parentType) {
          if (!element._store || element._store.validated || element.key != null) {
            return;
          }
          element._store.validated = true;
          var currentComponentErrorInfo = getCurrentComponentErrorInfo(parentType);
          if (ownerHasKeyUseWarning[currentComponentErrorInfo]) {
            return;
          }
          ownerHasKeyUseWarning[currentComponentErrorInfo] = true;
          var childOwner = "";
          if (element && element._owner && element._owner !== ReactCurrentOwner.current) {
            childOwner = " It was passed a child from " + getComponentNameFromType(element._owner.type) + ".";
          }
          {
            setCurrentlyValidatingElement$1(element);
            error('Each child in a list should have a unique "key" prop.%s%s See https://reactjs.org/link/warning-keys for more information.', currentComponentErrorInfo, childOwner);
            setCurrentlyValidatingElement$1(null);
          }
        }
        function validateChildKeys(node, parentType) {
          if (typeof node !== "object") {
            return;
          }
          if (isArray(node)) {
            for (var i = 0; i < node.length; i++) {
              var child = node[i];
              if (isValidElement(child)) {
                validateExplicitKey(child, parentType);
              }
            }
          } else if (isValidElement(node)) {
            if (node._store) {
              node._store.validated = true;
            }
          } else if (node) {
            var iteratorFn = getIteratorFn(node);
            if (typeof iteratorFn === "function") {
              if (iteratorFn !== node.entries) {
                var iterator = iteratorFn.call(node);
                var step;
                while (!(step = iterator.next()).done) {
                  if (isValidElement(step.value)) {
                    validateExplicitKey(step.value, parentType);
                  }
                }
              }
            }
          }
        }
        function validatePropTypes(element) {
          {
            var type = element.type;
            if (type === null || type === void 0 || typeof type === "string") {
              return;
            }
            var propTypes;
            if (typeof type === "function") {
              propTypes = type.propTypes;
            } else if (typeof type === "object" && (type.$$typeof === REACT_FORWARD_REF_TYPE || // Note: Memo only checks outer props here.
            // Inner props are checked in the reconciler.
            type.$$typeof === REACT_MEMO_TYPE)) {
              propTypes = type.propTypes;
            } else {
              return;
            }
            if (propTypes) {
              var name = getComponentNameFromType(type);
              checkPropTypes(propTypes, element.props, "prop", name, element);
            } else if (type.PropTypes !== void 0 && !propTypesMisspellWarningShown) {
              propTypesMisspellWarningShown = true;
              var _name = getComponentNameFromType(type);
              error("Component %s declared `PropTypes` instead of `propTypes`. Did you misspell the property assignment?", _name || "Unknown");
            }
            if (typeof type.getDefaultProps === "function" && !type.getDefaultProps.isReactClassApproved) {
              error("getDefaultProps is only used on classic React.createClass definitions. Use a static property named `defaultProps` instead.");
            }
          }
        }
        function validateFragmentProps(fragment) {
          {
            var keys = Object.keys(fragment.props);
            for (var i = 0; i < keys.length; i++) {
              var key = keys[i];
              if (key !== "children" && key !== "key") {
                setCurrentlyValidatingElement$1(fragment);
                error("Invalid prop `%s` supplied to `React.Fragment`. React.Fragment can only have `key` and `children` props.", key);
                setCurrentlyValidatingElement$1(null);
                break;
              }
            }
            if (fragment.ref !== null) {
              setCurrentlyValidatingElement$1(fragment);
              error("Invalid attribute `ref` supplied to `React.Fragment`.");
              setCurrentlyValidatingElement$1(null);
            }
          }
        }
        function createElementWithValidation(type, props, children) {
          var validType = isValidElementType(type);
          if (!validType) {
            var info = "";
            if (type === void 0 || typeof type === "object" && type !== null && Object.keys(type).length === 0) {
              info += " You likely forgot to export your component from the file it's defined in, or you might have mixed up default and named imports.";
            }
            var sourceInfo = getSourceInfoErrorAddendumForProps(props);
            if (sourceInfo) {
              info += sourceInfo;
            } else {
              info += getDeclarationErrorAddendum();
            }
            var typeString;
            if (type === null) {
              typeString = "null";
            } else if (isArray(type)) {
              typeString = "array";
            } else if (type !== void 0 && type.$$typeof === REACT_ELEMENT_TYPE) {
              typeString = "<" + (getComponentNameFromType(type.type) || "Unknown") + " />";
              info = " Did you accidentally export a JSX literal instead of a component?";
            } else {
              typeString = typeof type;
            }
            {
              error("React.createElement: type is invalid -- expected a string (for built-in components) or a class/function (for composite components) but got: %s.%s", typeString, info);
            }
          }
          var element = createElement.apply(this, arguments);
          if (element == null) {
            return element;
          }
          if (validType) {
            for (var i = 2; i < arguments.length; i++) {
              validateChildKeys(arguments[i], type);
            }
          }
          if (type === REACT_FRAGMENT_TYPE) {
            validateFragmentProps(element);
          } else {
            validatePropTypes(element);
          }
          return element;
        }
        var didWarnAboutDeprecatedCreateFactory = false;
        function createFactoryWithValidation(type) {
          var validatedFactory = createElementWithValidation.bind(null, type);
          validatedFactory.type = type;
          {
            if (!didWarnAboutDeprecatedCreateFactory) {
              didWarnAboutDeprecatedCreateFactory = true;
              warn("React.createFactory() is deprecated and will be removed in a future major release. Consider using JSX or use React.createElement() directly instead.");
            }
            Object.defineProperty(validatedFactory, "type", {
              enumerable: false,
              get: function() {
                warn("Factory.type is deprecated. Access the class directly before passing it to createFactory.");
                Object.defineProperty(this, "type", {
                  value: type
                });
                return type;
              }
            });
          }
          return validatedFactory;
        }
        function cloneElementWithValidation(element, props, children) {
          var newElement = cloneElement.apply(this, arguments);
          for (var i = 2; i < arguments.length; i++) {
            validateChildKeys(arguments[i], newElement.type);
          }
          validatePropTypes(newElement);
          return newElement;
        }
        function startTransition(scope, options) {
          var prevTransition = ReactCurrentBatchConfig.transition;
          ReactCurrentBatchConfig.transition = {};
          var currentTransition = ReactCurrentBatchConfig.transition;
          {
            ReactCurrentBatchConfig.transition._updatedFibers = /* @__PURE__ */ new Set();
          }
          try {
            scope();
          } finally {
            ReactCurrentBatchConfig.transition = prevTransition;
            {
              if (prevTransition === null && currentTransition._updatedFibers) {
                var updatedFibersCount = currentTransition._updatedFibers.size;
                if (updatedFibersCount > 10) {
                  warn("Detected a large number of updates inside startTransition. If this is due to a subscription please re-write it to use React provided hooks. Otherwise concurrent mode guarantees are off the table.");
                }
                currentTransition._updatedFibers.clear();
              }
            }
          }
        }
        var didWarnAboutMessageChannel = false;
        var enqueueTaskImpl = null;
        function enqueueTask(task) {
          if (enqueueTaskImpl === null) {
            try {
              var requireString = ("require" + Math.random()).slice(0, 7);
              var nodeRequire = module2 && module2[requireString];
              enqueueTaskImpl = nodeRequire.call(module2, "timers").setImmediate;
            } catch (_err) {
              enqueueTaskImpl = function(callback) {
                {
                  if (didWarnAboutMessageChannel === false) {
                    didWarnAboutMessageChannel = true;
                    if (typeof MessageChannel === "undefined") {
                      error("This browser does not have a MessageChannel implementation, so enqueuing tasks via await act(async () => ...) will fail. Please file an issue at https://github.com/facebook/react/issues if you encounter this warning.");
                    }
                  }
                }
                var channel = new MessageChannel();
                channel.port1.onmessage = callback;
                channel.port2.postMessage(void 0);
              };
            }
          }
          return enqueueTaskImpl(task);
        }
        var actScopeDepth = 0;
        var didWarnNoAwaitAct = false;
        function act(callback) {
          {
            var prevActScopeDepth = actScopeDepth;
            actScopeDepth++;
            if (ReactCurrentActQueue.current === null) {
              ReactCurrentActQueue.current = [];
            }
            var prevIsBatchingLegacy = ReactCurrentActQueue.isBatchingLegacy;
            var result;
            try {
              ReactCurrentActQueue.isBatchingLegacy = true;
              result = callback();
              if (!prevIsBatchingLegacy && ReactCurrentActQueue.didScheduleLegacyUpdate) {
                var queue = ReactCurrentActQueue.current;
                if (queue !== null) {
                  ReactCurrentActQueue.didScheduleLegacyUpdate = false;
                  flushActQueue(queue);
                }
              }
            } catch (error2) {
              popActScope(prevActScopeDepth);
              throw error2;
            } finally {
              ReactCurrentActQueue.isBatchingLegacy = prevIsBatchingLegacy;
            }
            if (result !== null && typeof result === "object" && typeof result.then === "function") {
              var thenableResult = result;
              var wasAwaited = false;
              var thenable = {
                then: function(resolve2, reject) {
                  wasAwaited = true;
                  thenableResult.then(function(returnValue2) {
                    popActScope(prevActScopeDepth);
                    if (actScopeDepth === 0) {
                      recursivelyFlushAsyncActWork(returnValue2, resolve2, reject);
                    } else {
                      resolve2(returnValue2);
                    }
                  }, function(error2) {
                    popActScope(prevActScopeDepth);
                    reject(error2);
                  });
                }
              };
              {
                if (!didWarnNoAwaitAct && typeof Promise !== "undefined") {
                  Promise.resolve().then(function() {
                  }).then(function() {
                    if (!wasAwaited) {
                      didWarnNoAwaitAct = true;
                      error("You called act(async () => ...) without await. This could lead to unexpected testing behaviour, interleaving multiple act calls and mixing their scopes. You should - await act(async () => ...);");
                    }
                  });
                }
              }
              return thenable;
            } else {
              var returnValue = result;
              popActScope(prevActScopeDepth);
              if (actScopeDepth === 0) {
                var _queue = ReactCurrentActQueue.current;
                if (_queue !== null) {
                  flushActQueue(_queue);
                  ReactCurrentActQueue.current = null;
                }
                var _thenable = {
                  then: function(resolve2, reject) {
                    if (ReactCurrentActQueue.current === null) {
                      ReactCurrentActQueue.current = [];
                      recursivelyFlushAsyncActWork(returnValue, resolve2, reject);
                    } else {
                      resolve2(returnValue);
                    }
                  }
                };
                return _thenable;
              } else {
                var _thenable2 = {
                  then: function(resolve2, reject) {
                    resolve2(returnValue);
                  }
                };
                return _thenable2;
              }
            }
          }
        }
        function popActScope(prevActScopeDepth) {
          {
            if (prevActScopeDepth !== actScopeDepth - 1) {
              error("You seem to have overlapping act() calls, this is not supported. Be sure to await previous act() calls before making a new one. ");
            }
            actScopeDepth = prevActScopeDepth;
          }
        }
        function recursivelyFlushAsyncActWork(returnValue, resolve2, reject) {
          {
            var queue = ReactCurrentActQueue.current;
            if (queue !== null) {
              try {
                flushActQueue(queue);
                enqueueTask(function() {
                  if (queue.length === 0) {
                    ReactCurrentActQueue.current = null;
                    resolve2(returnValue);
                  } else {
                    recursivelyFlushAsyncActWork(returnValue, resolve2, reject);
                  }
                });
              } catch (error2) {
                reject(error2);
              }
            } else {
              resolve2(returnValue);
            }
          }
        }
        var isFlushing = false;
        function flushActQueue(queue) {
          {
            if (!isFlushing) {
              isFlushing = true;
              var i = 0;
              try {
                for (; i < queue.length; i++) {
                  var callback = queue[i];
                  do {
                    callback = callback(true);
                  } while (callback !== null);
                }
                queue.length = 0;
              } catch (error2) {
                queue = queue.slice(i + 1);
                throw error2;
              } finally {
                isFlushing = false;
              }
            }
          }
        }
        var createElement$1 = createElementWithValidation;
        var cloneElement$1 = cloneElementWithValidation;
        var createFactory = createFactoryWithValidation;
        var Children = {
          map: mapChildren,
          forEach: forEachChildren,
          count: countChildren,
          toArray,
          only: onlyChild
        };
        exports2.Children = Children;
        exports2.Component = Component;
        exports2.Fragment = REACT_FRAGMENT_TYPE;
        exports2.Profiler = REACT_PROFILER_TYPE;
        exports2.PureComponent = PureComponent;
        exports2.StrictMode = REACT_STRICT_MODE_TYPE;
        exports2.Suspense = REACT_SUSPENSE_TYPE;
        exports2.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED = ReactSharedInternals;
        exports2.act = act;
        exports2.cloneElement = cloneElement$1;
        exports2.createContext = createContext;
        exports2.createElement = createElement$1;
        exports2.createFactory = createFactory;
        exports2.createRef = createRef;
        exports2.forwardRef = forwardRef;
        exports2.isValidElement = isValidElement;
        exports2.lazy = lazy;
        exports2.memo = memo;
        exports2.startTransition = startTransition;
        exports2.unstable_act = act;
        exports2.useCallback = useCallback;
        exports2.useContext = useContext;
        exports2.useDebugValue = useDebugValue2;
        exports2.useDeferredValue = useDeferredValue;
        exports2.useEffect = useEffect2;
        exports2.useId = useId;
        exports2.useImperativeHandle = useImperativeHandle;
        exports2.useInsertionEffect = useInsertionEffect;
        exports2.useLayoutEffect = useLayoutEffect;
        exports2.useMemo = useMemo;
        exports2.useReducer = useReducer;
        exports2.useRef = useRef2;
        exports2.useState = useState;
        exports2.useSyncExternalStore = useSyncExternalStore;
        exports2.useTransition = useTransition;
        exports2.version = ReactVersion;
        if (typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ !== "undefined" && typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.registerInternalModuleStop === "function") {
          __REACT_DEVTOOLS_GLOBAL_HOOK__.registerInternalModuleStop(new Error());
        }
      })();
    }
  }
});

// node_modules/react/index.js
var require_react = __commonJS({
  "node_modules/react/index.js"(exports2, module2) {
    "use strict";
    if (process.env.NODE_ENV === "production") {
      module2.exports = require_react_production_min();
    } else {
      module2.exports = require_react_development();
    }
  }
});

// src/hooks/fixture-tracks.ts
function resolveTrackTargets(track, patchedFixtures, fixtureGroups) {
  if (track.target.startsWith("fixture:")) {
    const fid = track.target.slice(8);
    return patchedFixtures.some((f) => f.id === fid) ? [fid] : [];
  }
  if (track.target.startsWith("group:")) {
    const gid = track.target.slice(6);
    const group = fixtureGroups.find((g) => g.id === gid);
    return group ? group.fixtureIds.filter((fid) => patchedFixtures.some((f) => f.id === fid)) : [];
  }
  if (track.target.startsWith("tier:")) {
    const tier = track.target.slice(5);
    return patchedFixtures.filter((f) => f.tier === tier).map((f) => f.id);
  }
  return [];
}
function generateEfxPanTilt(pattern, t, width, height, rotation, xOffset, yOffset) {
  const twoPi = Math.PI * 2;
  let rawPan = 0;
  let rawTilt = 0;
  switch (pattern) {
    case "Circle":
      rawPan = Math.sin(t * twoPi);
      rawTilt = Math.cos(t * twoPi);
      break;
    case "Line":
      rawPan = Math.sin(t * twoPi);
      rawTilt = Math.sin(t * twoPi);
      break;
    case "Eight":
      rawPan = Math.sin(t * twoPi);
      rawTilt = Math.sin(t * twoPi * 2);
      break;
    case "Square": {
      const phase = (t % 1 + 1) % 1;
      const corner = Math.round(phase * 4) % 4;
      rawPan = corner === 0 || corner === 1 ? 1 : -1;
      rawTilt = corner === 1 || corner === 2 ? 1 : -1;
      break;
    }
    case "Triangle": {
      const p = (t % 1 + 1) % 1;
      rawPan = p < 0.5 ? 4 * p - 1 : 3 - 4 * p;
      rawTilt = (t + 0.25) % 1 < 0.5 ? 4 * ((t + 0.25) % 1) - 1 : 3 - 4 * ((t + 0.25) % 1);
      break;
    }
    default:
      rawPan = Math.sin(t * twoPi);
      rawTilt = Math.cos(t * twoPi);
  }
  const cosR = Math.cos(rotation);
  const sinR = Math.sin(rotation);
  const rx = rawPan * cosR - rawTilt * sinR;
  const ry = rawPan * sinR + rawTilt * cosR;
  const w = width || 1;
  const h = height || 1;
  const ox = (xOffset || 0) / 255;
  const oy = (yOffset || 0) / 255;
  const prePan = Math.round(128 + rx * w * 127 + ox * 127);
  const preTilt = Math.round(128 + ry * h * 127 + oy * 127);
  return {
    pan: Math.max(0, Math.min(255, prePan)),
    tilt: Math.max(0, Math.min(255, preTilt))
  };
}
function computeEfxOverrides(efxTracks, currentTime, effects, patchedFixtures, fixtureGroups) {
  const result = /* @__PURE__ */ new Map();
  const effectMap = new Map(effects.map((e) => [e.id, e]));
  for (const track of efxTracks) {
    let targetIds;
    if (track.targetFixtures.type === "fixture") {
      targetIds = track.targetFixtures.fixtureIds || [];
    } else if (track.targetFixtures.type === "group") {
      const g = fixtureGroups.find((g2) => g2.id === track.targetFixtures.groupId);
      targetIds = g ? g.fixtureIds.filter((fid) => patchedFixtures.some((f) => f.id === fid)) : [];
    } else {
      targetIds = patchedFixtures.map((f) => f.id);
    }
    const activeEntry = track.entries.find(
      (e) => currentTime >= e.time && currentTime < e.endTime
    );
    if (!activeEntry) continue;
    const effect = effectMap.get(activeEntry.effectId);
    if (!effect) continue;
    const speed = effect.speed || 0.5;
    const relTime = (currentTime - activeEntry.time) * speed;
    const pt = generateEfxPanTilt(
      effect.pattern,
      relTime,
      effect.width,
      effect.height,
      effect.rotation,
      effect.xOffset,
      effect.yOffset
    );
    for (const fid of targetIds) {
      result.set(fid, pt);
    }
  }
  return result;
}
var init_fixture_tracks = __esm({
  "src/hooks/fixture-tracks.ts"() {
  }
});

// src/engine/dmx-movement.ts
function clampPanToStage(panDmx, x) {
  const d = panDmx - 128;
  return 128 + Math.max(-Math.round(x * 128), Math.min(Math.round((1 - x) * 128), d));
}
function clampTiltToStage(tiltDmx, y) {
  const d = tiltDmx - 128;
  return 128 + Math.max(-Math.round(Math.max(0.2, y) * 128), Math.min(Math.round(Math.min(1, y + 0.3) * 128), d));
}
function getSmartMovement(fixtureIndex, totalMobileFixtures, section, timeOffset) {
  const patterns = SMART_MOVEMENTS[section] || DEFAULT_SMART_MOVEMENTS;
  if (totalMobileFixtures <= 1) return patterns[0];
  let hash = 0;
  for (let i = 0; i < section.length; i++) hash = (hash << 5) - hash + section.charCodeAt(i);
  const timeIdx = timeOffset ? Math.floor(timeOffset / 8) : 0;
  const idx = (fixtureIndex + timeIdx + Math.abs(hash % 97)) % patterns.length;
  return patterns[idx];
}
var SMART_MOVEMENTS, DEFAULT_SMART_MOVEMENTS;
var init_dmx_movement = __esm({
  "src/engine/dmx-movement.ts"() {
    SMART_MOVEMENTS = {
      intro: ["static", "panOnly", "tiltOnly", "sweep", "wave"],
      verse: ["sweep", "wave", "panOnly", "figure8", "randomWalk", "panOnly"],
      chorus: ["circle", "sweep", "spiral", "diamond", "figure8", "bounce", "wave"],
      bridge: ["figure8", "wave", "zigzag", "randomWalk", "spiral", "diamond"],
      drop: ["bounce", "zigzag", "heartbeat", "circle", "spiral", "diamond", "randomWalk", "wave"],
      outro: ["tiltOnly", "panOnly", "sweep", "static", "wave"],
      build: ["spiral", "circle", "wave", "sweep", "diamond", "zigzag"]
    };
    DEFAULT_SMART_MOVEMENTS = ["sweep", "circle", "wave", "figure8", "zigzag"];
  }
});

// node_modules/zustand/esm/vanilla.mjs
var import_meta, createStoreImpl, createStore;
var init_vanilla = __esm({
  "node_modules/zustand/esm/vanilla.mjs"() {
    import_meta = {};
    createStoreImpl = (createState) => {
      let state;
      const listeners2 = /* @__PURE__ */ new Set();
      const setState = (partial, replace) => {
        const nextState = typeof partial === "function" ? partial(state) : partial;
        if (!Object.is(nextState, state)) {
          const previousState = state;
          state = (replace != null ? replace : typeof nextState !== "object" || nextState === null) ? nextState : Object.assign({}, state, nextState);
          listeners2.forEach((listener) => listener(state, previousState));
        }
      };
      const getState = () => state;
      const getInitialState = () => initialState;
      const subscribe = (listener) => {
        listeners2.add(listener);
        return () => listeners2.delete(listener);
      };
      const destroy = () => {
        if ((import_meta.env ? import_meta.env.MODE : void 0) !== "production") {
          console.warn(
            "[DEPRECATED] The `destroy` method will be unsupported in a future version. Instead use unsubscribe function returned by subscribe. Everything will be garbage-collected if store is garbage-collected."
          );
        }
        listeners2.clear();
      };
      const api = { setState, getState, getInitialState, subscribe, destroy };
      const initialState = state = createState(setState, getState, api);
      return api;
    };
    createStore = (createState) => createState ? createStoreImpl(createState) : createStoreImpl;
  }
});

// node_modules/use-sync-external-store/cjs/use-sync-external-store-shim.production.js
var require_use_sync_external_store_shim_production = __commonJS({
  "node_modules/use-sync-external-store/cjs/use-sync-external-store-shim.production.js"(exports2) {
    "use strict";
    var React = require_react();
    function is(x, y) {
      return x === y && (0 !== x || 1 / x === 1 / y) || x !== x && y !== y;
    }
    var objectIs = "function" === typeof Object.is ? Object.is : is;
    var useState = React.useState;
    var useEffect2 = React.useEffect;
    var useLayoutEffect = React.useLayoutEffect;
    var useDebugValue2 = React.useDebugValue;
    function useSyncExternalStore$2(subscribe, getSnapshot) {
      var value = getSnapshot(), _useState = useState({ inst: { value, getSnapshot } }), inst = _useState[0].inst, forceUpdate = _useState[1];
      useLayoutEffect(
        function() {
          inst.value = value;
          inst.getSnapshot = getSnapshot;
          checkIfSnapshotChanged(inst) && forceUpdate({ inst });
        },
        [subscribe, value, getSnapshot]
      );
      useEffect2(
        function() {
          checkIfSnapshotChanged(inst) && forceUpdate({ inst });
          return subscribe(function() {
            checkIfSnapshotChanged(inst) && forceUpdate({ inst });
          });
        },
        [subscribe]
      );
      useDebugValue2(value);
      return value;
    }
    function checkIfSnapshotChanged(inst) {
      var latestGetSnapshot = inst.getSnapshot;
      inst = inst.value;
      try {
        var nextValue = latestGetSnapshot();
        return !objectIs(inst, nextValue);
      } catch (error) {
        return true;
      }
    }
    function useSyncExternalStore$1(subscribe, getSnapshot) {
      return getSnapshot();
    }
    var shim = "undefined" === typeof window || "undefined" === typeof window.document || "undefined" === typeof window.document.createElement ? useSyncExternalStore$1 : useSyncExternalStore$2;
    exports2.useSyncExternalStore = void 0 !== React.useSyncExternalStore ? React.useSyncExternalStore : shim;
  }
});

// node_modules/use-sync-external-store/cjs/use-sync-external-store-shim.development.js
var require_use_sync_external_store_shim_development = __commonJS({
  "node_modules/use-sync-external-store/cjs/use-sync-external-store-shim.development.js"(exports2) {
    "use strict";
    "production" !== process.env.NODE_ENV && function() {
      function is(x, y) {
        return x === y && (0 !== x || 1 / x === 1 / y) || x !== x && y !== y;
      }
      function useSyncExternalStore$2(subscribe, getSnapshot) {
        didWarnOld18Alpha || void 0 === React.startTransition || (didWarnOld18Alpha = true, console.error(
          "You are using an outdated, pre-release alpha of React 18 that does not support useSyncExternalStore. The use-sync-external-store shim will not work correctly. Upgrade to a newer pre-release."
        ));
        var value = getSnapshot();
        if (!didWarnUncachedGetSnapshot) {
          var cachedValue = getSnapshot();
          objectIs(value, cachedValue) || (console.error(
            "The result of getSnapshot should be cached to avoid an infinite loop"
          ), didWarnUncachedGetSnapshot = true);
        }
        cachedValue = useState({
          inst: { value, getSnapshot }
        });
        var inst = cachedValue[0].inst, forceUpdate = cachedValue[1];
        useLayoutEffect(
          function() {
            inst.value = value;
            inst.getSnapshot = getSnapshot;
            checkIfSnapshotChanged(inst) && forceUpdate({ inst });
          },
          [subscribe, value, getSnapshot]
        );
        useEffect2(
          function() {
            checkIfSnapshotChanged(inst) && forceUpdate({ inst });
            return subscribe(function() {
              checkIfSnapshotChanged(inst) && forceUpdate({ inst });
            });
          },
          [subscribe]
        );
        useDebugValue2(value);
        return value;
      }
      function checkIfSnapshotChanged(inst) {
        var latestGetSnapshot = inst.getSnapshot;
        inst = inst.value;
        try {
          var nextValue = latestGetSnapshot();
          return !objectIs(inst, nextValue);
        } catch (error) {
          return true;
        }
      }
      function useSyncExternalStore$1(subscribe, getSnapshot) {
        return getSnapshot();
      }
      "undefined" !== typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ && "function" === typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.registerInternalModuleStart && __REACT_DEVTOOLS_GLOBAL_HOOK__.registerInternalModuleStart(Error());
      var React = require_react(), objectIs = "function" === typeof Object.is ? Object.is : is, useState = React.useState, useEffect2 = React.useEffect, useLayoutEffect = React.useLayoutEffect, useDebugValue2 = React.useDebugValue, didWarnOld18Alpha = false, didWarnUncachedGetSnapshot = false, shim = "undefined" === typeof window || "undefined" === typeof window.document || "undefined" === typeof window.document.createElement ? useSyncExternalStore$1 : useSyncExternalStore$2;
      exports2.useSyncExternalStore = void 0 !== React.useSyncExternalStore ? React.useSyncExternalStore : shim;
      "undefined" !== typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ && "function" === typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.registerInternalModuleStop && __REACT_DEVTOOLS_GLOBAL_HOOK__.registerInternalModuleStop(Error());
    }();
  }
});

// node_modules/use-sync-external-store/shim/index.js
var require_shim = __commonJS({
  "node_modules/use-sync-external-store/shim/index.js"(exports2, module2) {
    "use strict";
    if (process.env.NODE_ENV === "production") {
      module2.exports = require_use_sync_external_store_shim_production();
    } else {
      module2.exports = require_use_sync_external_store_shim_development();
    }
  }
});

// node_modules/use-sync-external-store/cjs/use-sync-external-store-shim/with-selector.production.js
var require_with_selector_production = __commonJS({
  "node_modules/use-sync-external-store/cjs/use-sync-external-store-shim/with-selector.production.js"(exports2) {
    "use strict";
    var React = require_react();
    var shim = require_shim();
    function is(x, y) {
      return x === y && (0 !== x || 1 / x === 1 / y) || x !== x && y !== y;
    }
    var objectIs = "function" === typeof Object.is ? Object.is : is;
    var useSyncExternalStore = shim.useSyncExternalStore;
    var useRef2 = React.useRef;
    var useEffect2 = React.useEffect;
    var useMemo = React.useMemo;
    var useDebugValue2 = React.useDebugValue;
    exports2.useSyncExternalStoreWithSelector = function(subscribe, getSnapshot, getServerSnapshot, selector, isEqual) {
      var instRef = useRef2(null);
      if (null === instRef.current) {
        var inst = { hasValue: false, value: null };
        instRef.current = inst;
      } else inst = instRef.current;
      instRef = useMemo(
        function() {
          function memoizedSelector(nextSnapshot) {
            if (!hasMemo) {
              hasMemo = true;
              memoizedSnapshot = nextSnapshot;
              nextSnapshot = selector(nextSnapshot);
              if (void 0 !== isEqual && inst.hasValue) {
                var currentSelection = inst.value;
                if (isEqual(currentSelection, nextSnapshot))
                  return memoizedSelection = currentSelection;
              }
              return memoizedSelection = nextSnapshot;
            }
            currentSelection = memoizedSelection;
            if (objectIs(memoizedSnapshot, nextSnapshot)) return currentSelection;
            var nextSelection = selector(nextSnapshot);
            if (void 0 !== isEqual && isEqual(currentSelection, nextSelection))
              return memoizedSnapshot = nextSnapshot, currentSelection;
            memoizedSnapshot = nextSnapshot;
            return memoizedSelection = nextSelection;
          }
          var hasMemo = false, memoizedSnapshot, memoizedSelection, maybeGetServerSnapshot = void 0 === getServerSnapshot ? null : getServerSnapshot;
          return [
            function() {
              return memoizedSelector(getSnapshot());
            },
            null === maybeGetServerSnapshot ? void 0 : function() {
              return memoizedSelector(maybeGetServerSnapshot());
            }
          ];
        },
        [getSnapshot, getServerSnapshot, selector, isEqual]
      );
      var value = useSyncExternalStore(subscribe, instRef[0], instRef[1]);
      useEffect2(
        function() {
          inst.hasValue = true;
          inst.value = value;
        },
        [value]
      );
      useDebugValue2(value);
      return value;
    };
  }
});

// node_modules/use-sync-external-store/cjs/use-sync-external-store-shim/with-selector.development.js
var require_with_selector_development = __commonJS({
  "node_modules/use-sync-external-store/cjs/use-sync-external-store-shim/with-selector.development.js"(exports2) {
    "use strict";
    "production" !== process.env.NODE_ENV && function() {
      function is(x, y) {
        return x === y && (0 !== x || 1 / x === 1 / y) || x !== x && y !== y;
      }
      "undefined" !== typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ && "function" === typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.registerInternalModuleStart && __REACT_DEVTOOLS_GLOBAL_HOOK__.registerInternalModuleStart(Error());
      var React = require_react(), shim = require_shim(), objectIs = "function" === typeof Object.is ? Object.is : is, useSyncExternalStore = shim.useSyncExternalStore, useRef2 = React.useRef, useEffect2 = React.useEffect, useMemo = React.useMemo, useDebugValue2 = React.useDebugValue;
      exports2.useSyncExternalStoreWithSelector = function(subscribe, getSnapshot, getServerSnapshot, selector, isEqual) {
        var instRef = useRef2(null);
        if (null === instRef.current) {
          var inst = { hasValue: false, value: null };
          instRef.current = inst;
        } else inst = instRef.current;
        instRef = useMemo(
          function() {
            function memoizedSelector(nextSnapshot) {
              if (!hasMemo) {
                hasMemo = true;
                memoizedSnapshot = nextSnapshot;
                nextSnapshot = selector(nextSnapshot);
                if (void 0 !== isEqual && inst.hasValue) {
                  var currentSelection = inst.value;
                  if (isEqual(currentSelection, nextSnapshot))
                    return memoizedSelection = currentSelection;
                }
                return memoizedSelection = nextSnapshot;
              }
              currentSelection = memoizedSelection;
              if (objectIs(memoizedSnapshot, nextSnapshot))
                return currentSelection;
              var nextSelection = selector(nextSnapshot);
              if (void 0 !== isEqual && isEqual(currentSelection, nextSelection))
                return memoizedSnapshot = nextSnapshot, currentSelection;
              memoizedSnapshot = nextSnapshot;
              return memoizedSelection = nextSelection;
            }
            var hasMemo = false, memoizedSnapshot, memoizedSelection, maybeGetServerSnapshot = void 0 === getServerSnapshot ? null : getServerSnapshot;
            return [
              function() {
                return memoizedSelector(getSnapshot());
              },
              null === maybeGetServerSnapshot ? void 0 : function() {
                return memoizedSelector(maybeGetServerSnapshot());
              }
            ];
          },
          [getSnapshot, getServerSnapshot, selector, isEqual]
        );
        var value = useSyncExternalStore(subscribe, instRef[0], instRef[1]);
        useEffect2(
          function() {
            inst.hasValue = true;
            inst.value = value;
          },
          [value]
        );
        useDebugValue2(value);
        return value;
      };
      "undefined" !== typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ && "function" === typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.registerInternalModuleStop && __REACT_DEVTOOLS_GLOBAL_HOOK__.registerInternalModuleStop(Error());
    }();
  }
});

// node_modules/use-sync-external-store/shim/with-selector.js
var require_with_selector = __commonJS({
  "node_modules/use-sync-external-store/shim/with-selector.js"(exports2, module2) {
    "use strict";
    if (process.env.NODE_ENV === "production") {
      module2.exports = require_with_selector_production();
    } else {
      module2.exports = require_with_selector_development();
    }
  }
});

// node_modules/zustand/esm/index.mjs
function useStore(api, selector = identity, equalityFn) {
  if ((import_meta2.env ? import_meta2.env.MODE : void 0) !== "production" && equalityFn && !didWarnAboutEqualityFn) {
    console.warn(
      "[DEPRECATED] Use `createWithEqualityFn` instead of `create` or use `useStoreWithEqualityFn` instead of `useStore`. They can be imported from 'zustand/traditional'. https://github.com/pmndrs/zustand/discussions/1937"
    );
    didWarnAboutEqualityFn = true;
  }
  const slice = useSyncExternalStoreWithSelector(
    api.subscribe,
    api.getState,
    api.getServerState || api.getInitialState,
    selector,
    equalityFn
  );
  useDebugValue(slice);
  return slice;
}
var import_react, import_with_selector, import_meta2, useDebugValue, useSyncExternalStoreWithSelector, didWarnAboutEqualityFn, identity, createImpl, create;
var init_esm = __esm({
  "node_modules/zustand/esm/index.mjs"() {
    init_vanilla();
    init_vanilla();
    import_react = __toESM(require_react(), 1);
    import_with_selector = __toESM(require_with_selector(), 1);
    import_meta2 = {};
    ({ useDebugValue } = import_react.default);
    ({ useSyncExternalStoreWithSelector } = import_with_selector.default);
    didWarnAboutEqualityFn = false;
    identity = (arg) => arg;
    createImpl = (createState) => {
      if ((import_meta2.env ? import_meta2.env.MODE : void 0) !== "production" && typeof createState !== "function") {
        console.warn(
          "[DEPRECATED] Passing a vanilla store will be unsupported in a future version. Instead use `import { useStore } from 'zustand'`."
        );
      }
      const api = typeof createState === "function" ? createStore(createState) : createState;
      const useBoundStore = (selector, equalityFn) => useStore(api, selector, equalityFn);
      Object.assign(useBoundStore, api);
      return useBoundStore;
    };
    create = (createState) => createState ? createImpl(createState) : createImpl;
  }
});

// node_modules/zustand/esm/middleware.mjs
function createJSONStorage(getStorage, options) {
  let storage;
  try {
    storage = getStorage();
  } catch (_e) {
    return;
  }
  const persistStorage = {
    getItem: (name) => {
      var _a;
      const parse = (str2) => {
        if (str2 === null) {
          return null;
        }
        return JSON.parse(str2, options == null ? void 0 : options.reviver);
      };
      const str = (_a = storage.getItem(name)) != null ? _a : null;
      if (str instanceof Promise) {
        return str.then(parse);
      }
      return parse(str);
    },
    setItem: (name, newValue) => storage.setItem(
      name,
      JSON.stringify(newValue, options == null ? void 0 : options.replacer)
    ),
    removeItem: (name) => storage.removeItem(name)
  };
  return persistStorage;
}
var import_meta3, toThenable, oldImpl, newImpl, persistImpl, persist;
var init_middleware = __esm({
  "node_modules/zustand/esm/middleware.mjs"() {
    import_meta3 = {};
    toThenable = (fn) => (input) => {
      try {
        const result = fn(input);
        if (result instanceof Promise) {
          return result;
        }
        return {
          then(onFulfilled) {
            return toThenable(onFulfilled)(result);
          },
          catch(_onRejected) {
            return this;
          }
        };
      } catch (e) {
        return {
          then(_onFulfilled) {
            return this;
          },
          catch(onRejected) {
            return toThenable(onRejected)(e);
          }
        };
      }
    };
    oldImpl = (config, baseOptions) => (set, get, api) => {
      let options = {
        getStorage: () => localStorage,
        serialize: JSON.stringify,
        deserialize: JSON.parse,
        partialize: (state) => state,
        version: 0,
        merge: (persistedState, currentState) => ({
          ...currentState,
          ...persistedState
        }),
        ...baseOptions
      };
      let hasHydrated = false;
      const hydrationListeners = /* @__PURE__ */ new Set();
      const finishHydrationListeners = /* @__PURE__ */ new Set();
      let storage;
      try {
        storage = options.getStorage();
      } catch (_e) {
      }
      if (!storage) {
        return config(
          (...args) => {
            console.warn(
              `[zustand persist middleware] Unable to update item '${options.name}', the given storage is currently unavailable.`
            );
            set(...args);
          },
          get,
          api
        );
      }
      const thenableSerialize = toThenable(options.serialize);
      const setItem = () => {
        const state = options.partialize({ ...get() });
        let errorInSync;
        const thenable = thenableSerialize({ state, version: options.version }).then(
          (serializedValue) => storage.setItem(options.name, serializedValue)
        ).catch((e) => {
          errorInSync = e;
        });
        if (errorInSync) {
          throw errorInSync;
        }
        return thenable;
      };
      const savedSetState = api.setState;
      api.setState = (state, replace) => {
        savedSetState(state, replace);
        void setItem();
      };
      const configResult = config(
        (...args) => {
          set(...args);
          void setItem();
        },
        get,
        api
      );
      let stateFromStorage;
      const hydrate = () => {
        var _a;
        if (!storage) return;
        hasHydrated = false;
        hydrationListeners.forEach((cb) => cb(get()));
        const postRehydrationCallback = ((_a = options.onRehydrateStorage) == null ? void 0 : _a.call(options, get())) || void 0;
        return toThenable(storage.getItem.bind(storage))(options.name).then((storageValue) => {
          if (storageValue) {
            return options.deserialize(storageValue);
          }
        }).then((deserializedStorageValue) => {
          if (deserializedStorageValue) {
            if (typeof deserializedStorageValue.version === "number" && deserializedStorageValue.version !== options.version) {
              if (options.migrate) {
                return options.migrate(
                  deserializedStorageValue.state,
                  deserializedStorageValue.version
                );
              }
              console.error(
                `State loaded from storage couldn't be migrated since no migrate function was provided`
              );
            } else {
              return deserializedStorageValue.state;
            }
          }
        }).then((migratedState) => {
          var _a2;
          stateFromStorage = options.merge(
            migratedState,
            (_a2 = get()) != null ? _a2 : configResult
          );
          set(stateFromStorage, true);
          return setItem();
        }).then(() => {
          postRehydrationCallback == null ? void 0 : postRehydrationCallback(stateFromStorage, void 0);
          hasHydrated = true;
          finishHydrationListeners.forEach((cb) => cb(stateFromStorage));
        }).catch((e) => {
          postRehydrationCallback == null ? void 0 : postRehydrationCallback(void 0, e);
        });
      };
      api.persist = {
        setOptions: (newOptions) => {
          options = {
            ...options,
            ...newOptions
          };
          if (newOptions.getStorage) {
            storage = newOptions.getStorage();
          }
        },
        clearStorage: () => {
          storage == null ? void 0 : storage.removeItem(options.name);
        },
        getOptions: () => options,
        rehydrate: () => hydrate(),
        hasHydrated: () => hasHydrated,
        onHydrate: (cb) => {
          hydrationListeners.add(cb);
          return () => {
            hydrationListeners.delete(cb);
          };
        },
        onFinishHydration: (cb) => {
          finishHydrationListeners.add(cb);
          return () => {
            finishHydrationListeners.delete(cb);
          };
        }
      };
      hydrate();
      return stateFromStorage || configResult;
    };
    newImpl = (config, baseOptions) => (set, get, api) => {
      let options = {
        storage: createJSONStorage(() => localStorage),
        partialize: (state) => state,
        version: 0,
        merge: (persistedState, currentState) => ({
          ...currentState,
          ...persistedState
        }),
        ...baseOptions
      };
      let hasHydrated = false;
      const hydrationListeners = /* @__PURE__ */ new Set();
      const finishHydrationListeners = /* @__PURE__ */ new Set();
      let storage = options.storage;
      if (!storage) {
        return config(
          (...args) => {
            console.warn(
              `[zustand persist middleware] Unable to update item '${options.name}', the given storage is currently unavailable.`
            );
            set(...args);
          },
          get,
          api
        );
      }
      const setItem = () => {
        const state = options.partialize({ ...get() });
        return storage.setItem(options.name, {
          state,
          version: options.version
        });
      };
      const savedSetState = api.setState;
      api.setState = (state, replace) => {
        savedSetState(state, replace);
        void setItem();
      };
      const configResult = config(
        (...args) => {
          set(...args);
          void setItem();
        },
        get,
        api
      );
      api.getInitialState = () => configResult;
      let stateFromStorage;
      const hydrate = () => {
        var _a, _b;
        if (!storage) return;
        hasHydrated = false;
        hydrationListeners.forEach((cb) => {
          var _a2;
          return cb((_a2 = get()) != null ? _a2 : configResult);
        });
        const postRehydrationCallback = ((_b = options.onRehydrateStorage) == null ? void 0 : _b.call(options, (_a = get()) != null ? _a : configResult)) || void 0;
        return toThenable(storage.getItem.bind(storage))(options.name).then((deserializedStorageValue) => {
          if (deserializedStorageValue) {
            if (typeof deserializedStorageValue.version === "number" && deserializedStorageValue.version !== options.version) {
              if (options.migrate) {
                return [
                  true,
                  options.migrate(
                    deserializedStorageValue.state,
                    deserializedStorageValue.version
                  )
                ];
              }
              console.error(
                `State loaded from storage couldn't be migrated since no migrate function was provided`
              );
            } else {
              return [false, deserializedStorageValue.state];
            }
          }
          return [false, void 0];
        }).then((migrationResult) => {
          var _a2;
          const [migrated, migratedState] = migrationResult;
          stateFromStorage = options.merge(
            migratedState,
            (_a2 = get()) != null ? _a2 : configResult
          );
          set(stateFromStorage, true);
          if (migrated) {
            return setItem();
          }
        }).then(() => {
          postRehydrationCallback == null ? void 0 : postRehydrationCallback(stateFromStorage, void 0);
          stateFromStorage = get();
          hasHydrated = true;
          finishHydrationListeners.forEach((cb) => cb(stateFromStorage));
        }).catch((e) => {
          postRehydrationCallback == null ? void 0 : postRehydrationCallback(void 0, e);
        });
      };
      api.persist = {
        setOptions: (newOptions) => {
          options = {
            ...options,
            ...newOptions
          };
          if (newOptions.storage) {
            storage = newOptions.storage;
          }
        },
        clearStorage: () => {
          storage == null ? void 0 : storage.removeItem(options.name);
        },
        getOptions: () => options,
        rehydrate: () => hydrate(),
        hasHydrated: () => hasHydrated,
        onHydrate: (cb) => {
          hydrationListeners.add(cb);
          return () => {
            hydrationListeners.delete(cb);
          };
        },
        onFinishHydration: (cb) => {
          finishHydrationListeners.add(cb);
          return () => {
            finishHydrationListeners.delete(cb);
          };
        }
      };
      if (!options.skipHydration) {
        hydrate();
      }
      return stateFromStorage || configResult;
    };
    persistImpl = (config, baseOptions) => {
      if ("getStorage" in baseOptions || "serialize" in baseOptions || "deserialize" in baseOptions) {
        if ((import_meta3.env ? import_meta3.env.MODE : void 0) !== "production") {
          console.warn(
            "[DEPRECATED] `getStorage`, `serialize` and `deserialize` options are deprecated. Use `storage` option instead."
          );
        }
        return oldImpl(config, baseOptions);
      }
      return newImpl(config, baseOptions);
    };
    persist = persistImpl;
  }
});

// src/stores/appStore.ts
var useAppStore;
var init_appStore = __esm({
  "src/stores/appStore.ts"() {
    init_esm();
    init_middleware();
    useAppStore = create()(
      persist(
        (set, get) => ({
          mode: "quick",
          quickSidebarTab: "autoscript",
          designSidebarTab: "scenes",
          performSidebarTab: "vconsole",
          quickShow: {
            audioActive: false,
            audioFileName: "",
            intensity: "dynamic",
            colorScheme: "auto",
            musicStyle: "dance",
            movement: "dynamic",
            beatDivision: 2,
            strobeLimit: 10,
            panMaxDeg: 270,
            tiltMaxDeg: 90,
            forcedPanMaxDeg: {},
            forcedTiltMaxDeg: {},
            sectionAware: true,
            audioReactive: true,
            customPalette: {
              intro: [],
              verse: [],
              chorus: [],
              bridge: [],
              drop: [],
              outro: [],
              build: []
            },
            colorPresets: [],
            userPreset: ["#ff5000", "#ff8c00", "#ffc832"],
            tierConfig: {
              primary: 100,
              secondary: 70,
              tertiary: 40
            },
            forcedColors: {},
            forcedDimmer: {},
            forcedStrobe: {},
            showColorTrack: false,
            showStrobeTrack: false,
            showDimmerTrack: false,
            colorFadeMs: 250,
            customGradients: {},
            gradientPresets: [],
            colorEntries: [],
            dimmerEntries: [],
            strobeEntries: []
          },
          dmx: {
            running: false,
            blackout: false,
            grandMaster: 255,
            panTiltMaxSpeed: 120,
            universes: [
              { id: "u1", name: "Universe 1", type: "virtual", output: true, channels: 512 }
            ],
            channelData: {}
          },
          fixtures: {
            library: [],
            searchResults: [],
            selected: null,
            instances: []
          },
          show: {
            current: null,
            dirty: false,
            filePath: null,
            recentShows: []
          },
          audio: {
            analyzing: false,
            deviceId: null,
            analysis: null,
            bpm: 0
          },
          isDirty: false,
          markDirty: () => set({ isDirty: true }),
          markClean: () => set({ isDirty: false }),
          projectName: "",
          setProjectName: (name) => set({ projectName: name }),
          presetName: "",
          setPresetName: (name) => set({ presetName: name }),
          setMode: (mode) => set({ mode }),
          setQuickSidebarTab: (tab) => set({ quickSidebarTab: tab }),
          setDesignSidebarTab: (tab) => set({ designSidebarTab: tab }),
          setPerformSidebarTab: (tab) => set({ performSidebarTab: tab }),
          setQuickShow: (partial) => set((state) => {
            const partialKeys = Object.keys(partial);
            const isFullReplace = partialKeys.length >= 8 || "intensity" in partial && "colorScheme" in partial && "movement" in partial && "strobeLimit" in partial;
            if (isFullReplace) {
              const incoming = partial;
              return {
                quickShow: {
                  audioActive: incoming.audioActive ?? state.quickShow.audioActive,
                  audioFileName: incoming.audioFileName ?? "",
                  intensity: incoming.intensity ?? "dynamic",
                  colorScheme: incoming.colorScheme ?? "auto",
                  musicStyle: incoming.musicStyle ?? "dance",
                  movement: incoming.movement ?? "dynamic",
                  beatDivision: incoming.beatDivision ?? 2,
                  strobeLimit: incoming.strobeLimit ?? 10,
                  panMaxDeg: incoming.panMaxDeg ?? 270,
                  tiltMaxDeg: incoming.tiltMaxDeg ?? 90,
                  sectionAware: incoming.sectionAware ?? true,
                  customPalette: incoming.customPalette ?? { intro: [], verse: [], chorus: [], bridge: [], drop: [], outro: [], build: [] },
                  colorPresets: Array.isArray(incoming.colorPresets) ? incoming.colorPresets : [],
                  userPreset: Array.isArray(incoming.userPreset) ? incoming.userPreset : ["#ff5000", "#ff8c00", "#ffc832"],
                  // Migration: handle both old (primaryMultiplier) and new (primary) property names
                  tierConfig: incoming.tierConfig ? {
                    primary: incoming.tierConfig.primary ?? incoming.tierConfig.primaryMultiplier ?? 100,
                    secondary: incoming.tierConfig.secondary ?? incoming.tierConfig.secondaryMultiplier ?? 70,
                    tertiary: incoming.tierConfig.tertiary ?? incoming.tierConfig.tertiaryMultiplier ?? 40
                  } : { primary: 100, secondary: 70, tertiary: 40 },
                  forcedColors: incoming.forcedColors || {},
                  forcedDimmer: incoming.forcedDimmer || {},
                  forcedStrobe: incoming.forcedStrobe || {},
                  forcedPanMaxDeg: incoming.forcedPanMaxDeg || {},
                  forcedTiltMaxDeg: incoming.forcedTiltMaxDeg || {},
                  showColorTrack: incoming.showColorTrack ?? false,
                  showStrobeTrack: incoming.showStrobeTrack ?? false,
                  showDimmerTrack: incoming.showDimmerTrack ?? false,
                  audioReactive: incoming.audioReactive ?? true,
                  colorFadeMs: incoming.colorFadeMs ?? 250,
                  customGradients: incoming.customGradients ?? {},
                  gradientPresets: Array.isArray(incoming.gradientPresets) ? incoming.gradientPresets : [],
                  colorEntries: Array.isArray(incoming.colorEntries) ? incoming.colorEntries : [],
                  dimmerEntries: Array.isArray(incoming.dimmerEntries) ? incoming.dimmerEntries : [],
                  strobeEntries: Array.isArray(incoming.strobeEntries) ? incoming.strobeEntries : []
                }
              };
            }
            return {
              quickShow: {
                ...state.quickShow,
                colorPresets: state.quickShow.colorPresets || [],
                customPalette: state.quickShow.customPalette || {},
                ...partial
              }
            };
          }),
          setCustomPalette: (partial) => set((state) => ({
            quickShow: {
              ...state.quickShow,
              customPalette: { ...state.quickShow.customPalette, ...partial }
            }
          })),
          clearCustomPalette: () => set((state) => ({
            quickShow: {
              ...state.quickShow,
              customPalette: {
                intro: [],
                verse: [],
                chorus: [],
                bridge: [],
                drop: [],
                outro: [],
                build: []
              }
            }
          })),
          addColorPreset: (name, colors) => {
            const id = `cp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            set((state) => ({
              quickShow: {
                ...state.quickShow,
                colorPresets: [...state.quickShow.colorPresets, { id, name, colors }]
              }
            }));
            return id;
          },
          updateColorPreset: (id, patch) => set((state) => ({
            quickShow: {
              ...state.quickShow,
              colorPresets: state.quickShow.colorPresets.map(
                (p) => p.id === id ? { ...p, ...patch } : p
              )
            }
          })),
          deleteColorPreset: (id) => set((state) => ({
            quickShow: {
              ...state.quickShow,
              colorPresets: state.quickShow.colorPresets.filter((p) => p.id !== id)
            }
          })),
          setUserPreset: (colors) => set((state) => ({
            quickShow: { ...state.quickShow, userPreset: colors }
          })),
          setDMXRunning: (running) => set((state) => ({ dmx: { ...state.dmx, running } })),
          setBlackout: (blackout) => set((state) => ({ dmx: { ...state.dmx, blackout } })),
          setGrandMaster: (value) => set((state) => ({ dmx: { ...state.dmx, grandMaster: value } })),
          setPanTiltMaxSpeed: (value) => set((state) => ({ dmx: { ...state.dmx, panTiltMaxSpeed: Math.max(20, Math.min(720, value)) } })),
          setChannelValue: (universe, channel, value) => {
            const { dmx } = get();
            const raw = dmx.channelData || {};
            const prev = raw[universe];
            let data;
            if (prev instanceof Uint8Array) {
              data = prev;
            } else if (prev && typeof prev === "object") {
              data = new Uint8Array(Object.values(prev));
            } else {
              data = new Uint8Array(512);
            }
            data[channel - 1] = value;
            set({ dmx: { ...dmx, channelData: { ...raw, [universe]: data } } });
          },
          setUniverseData: (universe, values) => {
            const { dmx } = get();
            const raw = dmx.channelData || {};
            const prev = raw[universe];
            let data;
            if (prev instanceof Uint8Array) {
              data = prev;
            } else if (prev && typeof prev === "object") {
              data = new Uint8Array(Object.values(prev));
            } else {
              data = new Uint8Array(512);
            }
            for (const chStr in values) {
              const idx = Number(chStr) - 1;
              if (idx >= 0 && idx < 512) data[idx] = values[chStr];
            }
            set({ dmx: { ...dmx, channelData: { ...raw, [universe]: data } } });
          },
          setAudioAnalysis: (analysis) => set((state) => ({
            audio: {
              ...state.audio,
              analysis,
              bpm: analysis?.bpm || state.audio.bpm
            }
          })),
          setAudioRunning: (running) => set((state) => ({
            audio: { ...state.audio, analyzing: running }
          }))
        }),
        {
          name: "light-maestro-store",
          partialize: (state) => ({
            mode: state.mode,
            quickShow: state.quickShow,
            quickSidebarTab: state.quickSidebarTab,
            designSidebarTab: state.designSidebarTab,
            performSidebarTab: state.performSidebarTab,
            dmx: {
              universes: state.dmx.universes,
              grandMaster: state.dmx.grandMaster,
              panTiltMaxSpeed: state.dmx.panTiltMaxSpeed
            },
            show: {
              recentShows: state.show.recentShows
            }
          }),
          merge: (persisted, current) => ({
            ...current,
            ...persisted,
            dmx: {
              ...current.dmx,
              ...persisted.dmx || {},
              channelData: current.dmx.channelData || {}
              // Map - never overwritten by stale JSON
            }
          })
        }
      )
    );
  }
});

// src/engine/output-arbiter.ts
function clampChannel(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(255, Math.round(value)));
}
var DEFAULT_SOURCES, OutputArbiter, outputArbiter;
var init_output_arbiter = __esm({
  "src/engine/output-arbiter.ts"() {
    DEFAULT_SOURCES = {
      // Control (LTP) — operator-driven, must always win
      "simple-desk": { mode: "ltp", priority: 100 },
      "fixture-test": { mode: "ltp", priority: 90 },
      "vc": { mode: "ltp", priority: 80 },
      "design-efx": { mode: "ltp", priority: 70 },
      "design-test": { mode: "ltp", priority: 60 },
      "fixture-onoff": { mode: "ltp", priority: 60 },
      "default": { mode: "ltp", priority: 50 },
      // Light (HTP) — content sources that blend together
      "song-preset": { mode: "htp", priority: 45 },
      "quickshow": { mode: "htp", priority: 40 },
      "show-manager": { mode: "htp", priority: 35 },
      "rgb-matrix": { mode: "htp", priority: 30 }
    };
    OutputArbiter = class {
      _sources = /* @__PURE__ */ new Map();
      /** universe → sourceId → channel values (already clamped). */
      _values = /* @__PURE__ */ new Map();
      _seq = 0;
      constructor() {
        for (const [id, spec] of Object.entries(DEFAULT_SOURCES)) {
          this.registerSource(id, spec.mode, spec.priority);
        }
      }
      /** Register (or re-register) a source. Re-registering keeps its values. */
      registerSource(id, mode, priority) {
        this._sources.set(id, { mode, priority, seq: this._seq++ });
      }
      unregisterSource(id) {
        this._sources.delete(id);
        for (const uni of this._values.values()) uni.delete(id);
      }
      isRegistered(id) {
        return this._sources.has(id);
      }
      /**
       * Store a source's channel values for a universe (replaces the source's
       * previous contribution on that universe — it does NOT merge).
       * Unknown sources are ignored so a typo never corrupts the output.
       * Returns true when the write was accepted.
       */
      write(id, universe, channels) {
        const spec = this._sources.get(id);
        if (!spec) return false;
        const clean = {};
        for (const chStr in channels) {
          const ch = Number(chStr);
          if (!Number.isFinite(ch) || ch < 0) continue;
          clean[ch] = clampChannel(Number(channels[chStr]));
        }
        let uni = this._values.get(universe);
        if (!uni) {
          uni = /* @__PURE__ */ new Map();
          this._values.set(universe, uni);
        }
        uni.set(id, clean);
        return true;
      }
      /**
       * Remove a source's contribution (all universes, or only `universe`).
       * Once released, the channels it owned fall back to the remaining sources.
       */
      release(id, universe) {
        if (universe !== void 0) {
          this._values.get(universe)?.delete(id);
        } else {
          for (const uni of this._values.values()) uni.delete(id);
        }
      }
      /** Last values written by `id` on `universe` (undefined when none). */
      getSourceValues(id, universe) {
        return this._values.get(universe)?.get(id);
      }
      /**
       * Compute the final combined buffer for a universe.
       * Deterministic: LTP sources (highest priority first) take their channels,
       * HTP sources contribute their per-channel maximum everywhere else.
       */
      getBuffer(universe) {
        const uni = this._values.get(universe);
        if (!uni || uni.size === 0) return {};
        if (uni.size === 1) {
          const [, vals] = uni.entries().next().value;
          return vals;
        }
        const sorted = [];
        for (const [id, vals] of uni) {
          const spec = this._sources.get(id);
          if (!spec) continue;
          sorted.push({ id, spec, vals });
        }
        sorted.sort((a, b) => b.spec.priority - a.spec.priority || a.spec.seq - b.spec.seq);
        const buffer = {};
        const taken = /* @__PURE__ */ new Set();
        const htp = /* @__PURE__ */ new Map();
        for (const { spec, vals } of sorted) {
          if (spec.mode === "ltp") {
            for (const chStr of Object.keys(vals)) {
              const ch = Number(chStr);
              if (taken.has(ch)) continue;
              buffer[ch] = vals[ch];
              taken.add(ch);
            }
          } else {
            for (const chStr of Object.keys(vals)) {
              const ch = Number(chStr);
              if (taken.has(ch)) continue;
              const prev = htp.get(ch);
              htp.set(ch, prev === void 0 ? vals[ch] : Math.max(prev, vals[ch]));
            }
          }
        }
        for (const [ch, v] of htp) {
          if (!taken.has(ch)) buffer[ch] = v;
        }
        return buffer;
      }
      /** All universes that currently hold at least one source contribution. */
      getActiveUniverses() {
        return [...this._values.keys()];
      }
    };
    outputArbiter = new OutputArbiter();
  }
});

// src/utils/latency-meter.ts
function recordAudioTick(now = performance.now()) {
  lastAudioTickMs = now;
  audioTickPending = true;
}
function recordOutputTick(now = performance.now()) {
  if (!audioTickPending || lastAudioTickMs === null) return;
  audioTickPending = false;
  const delta = now - lastAudioTickMs;
  if (delta < 0 || delta > MAX_SAMPLE_MS) return;
  samples.push(delta);
  if (samples.length > WINDOW_SIZE) samples.shift();
}
var WINDOW_SIZE, MAX_SAMPLE_MS, lastAudioTickMs, audioTickPending, samples;
var init_latency_meter = __esm({
  "src/utils/latency-meter.ts"() {
    WINDOW_SIZE = 30;
    MAX_SAMPLE_MS = 1e3;
    lastAudioTickMs = null;
    audioTickPending = false;
    samples = [];
  }
});

// src/utils/dmx-bridge.ts
function cancelTransient(sourceId) {
  const t = transientTimers.get(sourceId);
  if (t) {
    clearTimeout(t);
    transientTimers.delete(sourceId);
  }
}
function getDmxApi() {
  return typeof window !== "undefined" ? window.lightMaestro?.dmx : null;
}
function pushBufferToConsumers(universe, buffer) {
  _channelCache.set(universe, buffer);
  for (const fn of listeners) {
    try {
      fn(universe, buffer);
    } catch (_) {
    }
  }
}
function flushToHardware(universe, buffer) {
  if (_dryRun) return;
  const api = getDmxApi();
  if (!api) return;
  api.setChannels(universe, buffer).catch(() => {
  });
}
var listeners, _channelCache, _dryRun, transientTimers, dmxBridge;
var init_dmx_bridge = __esm({
  "src/utils/dmx-bridge.ts"() {
    init_output_arbiter();
    init_latency_meter();
    listeners = /* @__PURE__ */ new Set();
    _channelCache = /* @__PURE__ */ new Map();
    _dryRun = false;
    transientTimers = /* @__PURE__ */ new Map();
    dmxBridge = {
      /**
       * Arbitrated write from any source. The arbitrated buffer for `universe`
       * is recomputed and pushed to the cache, listeners and hardware.
       */
      write(sourceId, universe, channels) {
        if (!outputArbiter.write(sourceId, universe, channels)) return;
        cancelTransient(sourceId);
        const buffer = outputArbiter.getBuffer(universe);
        pushBufferToConsumers(universe, buffer);
        recordOutputTick();
        flushToHardware(universe, buffer);
      },
      /**
       * Write then automatically release the source after `ms` (default 2 s).
       * Used by "stop/zero" paths (VC stop, Simple Desk reset, design-panel
       * blackout, fixture off) so the hardware receives the zeros — flushing
       * the current output — while control falls back to the playback engine
       * shortly after, instead of pinning the source forever (LTP persistence).
       * Any regular write() from the same source cancels the pending release.
       */
      writeTransient(sourceId, universe, channels, ms = 2e3) {
        if (!outputArbiter.write(sourceId, universe, channels)) return;
        const buffer = outputArbiter.getBuffer(universe);
        pushBufferToConsumers(universe, buffer);
        recordOutputTick();
        flushToHardware(universe, buffer);
        cancelTransient(sourceId);
        transientTimers.set(sourceId, setTimeout(() => {
          transientTimers.delete(sourceId);
          this.release(sourceId);
        }, ms));
      },
      /**
       * Called by the playback engine (dmx-playback.ts) after computing DMX
       * values for the current frame. `sourceId` defaults to the QuickShow
       * engine; SongPresetPlayer passes 'song-preset' so its own zeroing /
       * release logic stays scoped to its source.
       */
      push(universe, channels, sourceId = "quickshow") {
        this.write(sourceId, universe, channels);
      },
      /**
       * Write while MERGING with the source's previous values on that universe
       * (per-channel update instead of replace-all). Needed by incremental
       * single-channel callers (fixture test steps, VC sliders) so writing
       * channel A then channel B keeps both.
       */
      writeMerge(sourceId, universe, channels) {
        const prev = outputArbiter.getSourceValues(sourceId, universe) ?? {};
        const merged = { ...prev };
        for (const [chStr, v] of Object.entries(channels)) {
          merged[Number(chStr)] = v;
        }
        this.write(sourceId, universe, merged);
      },
      /** Remove a source's contribution (all universes, or only `universe`).
       *  Affected universes are recomputed and re-flushed so the hardware and
       *  the 3D cache follow the arbitration (control returns to the engine). */
      release(sourceId, universe) {
        const affected = universe !== void 0 ? [universe] : outputArbiter.getActiveUniverses();
        outputArbiter.release(sourceId, universe);
        for (const u of affected) {
          const buffer = outputArbiter.getBuffer(u);
          pushBufferToConsumers(u, buffer);
          recordOutputTick();
          flushToHardware(u, buffer);
        }
      },
      /** Toggle hardware output without stopping computation (QuickShow dry-run). */
      setDryRun(dryRun) {
        _dryRun = dryRun;
      },
      isDryRun() {
        return _dryRun;
      },
      /** Register a custom source (mode 'htp' | 'ltp', higher priority wins). */
      registerSource(id, mode, priority) {
        outputArbiter.registerSource(id, mode, priority);
      },
      /**
       * Push a single channel change from the design panel (3D → Live DMX).
       * Written through the 'design-test' source so other sources keep their
       * priority; merges with the source's previous values so consecutive
       * single-channel pushes do not drop each other.
       */
      pushDesignChannel(universe, channelAddr, value) {
        const clamped = Math.max(0, Math.min(255, Math.round(value)));
        const prev = outputArbiter.getSourceValues("design-test", universe) ?? {};
        const merged = { ...prev, [channelAddr]: clamped };
        this.write("design-test", universe, merged);
      },
      /** Stage3D reads the latest channel values for a universe */
      getChannels(universe) {
        return _channelCache.get(universe);
      },
      /** Called by Stage3D to receive DMX pushes */
      onPush(fn) {
        listeners.add(fn);
        return () => listeners.delete(fn);
      }
    };
  }
});

// src/hooks/dmx-playback.ts
var dmx_playback_exports = {};
__export(dmx_playback_exports, {
  computeChaserTrackOverrides: () => computeChaserTrackOverrides,
  computeColorTrackColors: () => computeColorTrackColors,
  computeDimmerTrackOverrides: () => computeDimmerTrackOverrides,
  computeDmxForCue: () => computeDmxForCue,
  computeLaserChannels: () => computeLaserChannels,
  computeStrobeTrackOverrides: () => computeStrobeTrackOverrides,
  dispatchChannelsByFixture: () => dispatchChannelsByFixture,
  useDmxPlayback: () => useDmxPlayback
});
function computeStrobeTrackOverrides(strobeTracks, currentTime, patchedFixtures, fixtureGroups) {
  const result = /* @__PURE__ */ new Map();
  for (const stItem of strobeTracks) {
    if (stItem.entries.length === 0) continue;
    const activeEntry = stItem.entries.find((e) => currentTime >= e.time && currentTime < e.endTime);
    if (!activeEntry || !stItem.targetFixtures) continue;
    const tf = stItem.targetFixtures;
    let targets = [];
    if (tf.type === "all") {
      targets = patchedFixtures.map((f) => f.id);
    } else if (tf.type === "group" && tf.groupId) {
      const group = fixtureGroups.find((g) => g.id === tf.groupId);
      targets = group?.fixtureIds || [];
    } else if (tf.type === "fixture" && tf.fixtureIds) {
      targets = tf.fixtureIds;
    }
    for (const fid of targets) {
      let speed = activeEntry.speed;
      if (activeEntry.endSpeed !== void 0 && activeEntry.endSpeed !== activeEntry.speed) {
        const dur = activeEntry.endTime - activeEntry.time;
        const t = dur > 0 ? Math.max(0, Math.min(1, (currentTime - activeEntry.time) / dur)) : 1;
        speed = activeEntry.speed + (activeEntry.endSpeed - activeEntry.speed) * t;
      }
      result.set(fid, { active: true, speed });
    }
  }
  return result;
}
function computeDimmerTrackOverrides(dimmerTracks, currentTime, patchedFixtures, fixtureGroups) {
  const result = /* @__PURE__ */ new Map();
  for (const dtItem of dimmerTracks) {
    if (dtItem.entries.length === 0) continue;
    const activeEntry = dtItem.entries.find((e) => currentTime >= e.time && currentTime < e.endTime);
    if (!activeEntry || !dtItem.targetFixtures) continue;
    const tf = dtItem.targetFixtures;
    let targets = [];
    if (tf.type === "all") {
      targets = patchedFixtures.map((f) => f.id);
    } else if (tf.type === "group" && tf.groupId) {
      const group = fixtureGroups.find((g) => g.id === tf.groupId);
      targets = group?.fixtureIds || [];
    } else if (tf.type === "fixture" && tf.fixtureIds) {
      targets = tf.fixtureIds;
    }
    for (const fid of targets) {
      let value = activeEntry.value;
      if (activeEntry.endValue !== void 0 && activeEntry.endValue !== activeEntry.value) {
        const dur = activeEntry.endTime - activeEntry.time;
        const t = dur > 0 ? Math.max(0, Math.min(1, (currentTime - activeEntry.time) / dur)) : 1;
        value = activeEntry.value + (activeEntry.endValue - activeEntry.value) * t;
      }
      result.set(fid, { active: true, value });
    }
  }
  return result;
}
function computeColorTrackColors(colorTracks, currentTime, patchedFixtures, fixtureGroups) {
  const result = /* @__PURE__ */ new Map();
  for (const ctItem of colorTracks) {
    if (!ctItem.entries || ctItem.entries.length === 0) continue;
    const activeEntry = ctItem.entries.find((e) => currentTime >= e.time && currentTime < e.endTime);
    if (!activeEntry || !ctItem.targetFixtures) continue;
    const tf = ctItem.targetFixtures;
    let targets = [];
    if (tf.type === "all") {
      targets = patchedFixtures.map((f) => f.id);
    } else if (tf.type === "group" && tf.groupId) {
      const group = fixtureGroups.find((g) => g.id === tf.groupId);
      targets = group?.fixtureIds || [];
    } else if (tf.type === "fixture" && tf.fixtureIds) {
      targets = tf.fixtureIds;
    }
    const entryColor = typeof activeEntry.color === "string" && activeEntry.color.startsWith("#") ? activeEntry.color : typeof activeEntry.endColor === "string" && activeEntry.endColor?.startsWith("#") ? activeEntry.endColor : void 0;
    const entryEndColor = typeof activeEntry.endColor === "string" && activeEntry.endColor.startsWith("#") ? activeEntry.endColor : void 0;
    for (const fid of targets) {
      if (entryEndColor && entryColor && entryEndColor !== entryColor) {
        const dur = activeEntry.endTime - activeEntry.time;
        const t = dur > 0 ? Math.max(0, Math.min(1, (currentTime - activeEntry.time) / dur)) : 1;
        const [sr, sg, sb] = hexToRgb(entryColor);
        const [er, eg, eb] = hexToRgb(entryEndColor);
        const r = Math.round(sr + (er - sr) * t);
        const g = Math.round(sg + (eg - sg) * t);
        const b = Math.round(sb + (eb - sb) * t);
        result.set(fid, `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`);
      } else if (entryColor) {
        result.set(fid, entryColor);
      }
    }
  }
  return result;
}
function computeChaserTrackOverrides(chaserTracks, chasers, scenes, currentTime, patchedFixtures, fixtureGroups) {
  const controlled = /* @__PURE__ */ new Map();
  for (const tr of chaserTracks) {
    if (!tr.entries || tr.entries.length === 0 || !tr.targetFixtures) continue;
    const entry = tr.entries.find((e) => currentTime >= e.time && currentTime < e.endTime);
    if (!entry) continue;
    const chaser = chasers.find((c) => c.id === entry.chaserId);
    if (!chaser || !chaser.steps || chaser.steps.length === 0) continue;
    const sceneIds = new Set(chaser.steps.map((s) => s.sceneId));
    const addrSet = /* @__PURE__ */ new Set();
    for (const sc of scenes) {
      if (sceneIds.has(sc.id) && sc.channels) {
        for (const addrStr of Object.keys(sc.channels)) addrSet.add(Number(addrStr));
      }
    }
    let targets = [];
    for (const pf of patchedFixtures) {
      for (let a = pf.startAddress; a < pf.startAddress + pf.channelCount; a++) {
        if (addrSet.has(a)) {
          targets.push(pf.id);
          break;
        }
      }
    }
    if (targets.length === 0) continue;
    const cycles = chaser.steps.map((s) => Math.max(1, (s.fadeIn || 0) + (s.hold || 0) + (s.fadeOut || 0)));
    const total = cycles.reduce((a, b) => a + b, 0);
    const pos = total > 0 ? Math.max(0, (currentTime - entry.time) * 1e3) % total : 0;
    let acc = 0;
    let stepIdx = 0;
    for (let i = 0; i < cycles.length; i++) {
      if (pos < acc + cycles[i]) {
        stepIdx = i;
        break;
      }
      acc += cycles[i];
      stepIdx = i;
    }
    const step = chaser.steps[stepIdx];
    const sd = cycles[stepIdx] || 1;
    const within = pos - acc;
    const fi = Math.max(1, step.fadeIn || 0);
    const fo = Math.max(1, step.fadeOut || 0);
    let scale = 1;
    if (within < fi) scale = Math.min(1, within / fi);
    else if (within >= sd - fo) scale = Math.max(0, 1 - (within - (sd - fo)) / fo);
    else scale = 1;
    const scene = scenes.find((s) => s.id === step.sceneId);
    if (!scene || !scene.channels) continue;
    const addrMap = {};
    for (const addrStr in scene.channels) {
      const addr = Number(addrStr);
      const val = Number(scene.channels[addrStr]);
      addrMap[addr] = Math.max(0, Math.min(255, Math.round(Number.isFinite(val) ? val * scale : 0)));
    }
    for (const fid of targets) controlled.set(fid, addrMap);
  }
  return controlled;
}
function dispatchChannelsByFixture(channelValues, patchedFixtures, universes) {
  const uniIds = universes.map((u) => String(u.id));
  const dispatched = /* @__PURE__ */ new Map();
  for (const pf of patchedFixtures) {
    const uniIdx = uniIds.indexOf(pf.universeId);
    const uniNum = uniIdx >= 0 ? uniIdx : 0;
    const base = pf.startAddress;
    const endAddr = base + pf.channelCount;
    const uniVals = dispatched.get(uniNum) || {};
    for (const addrStr in channelValues) {
      const val = channelValues[addrStr];
      const addr = Number(addrStr);
      if (addr >= base && addr < endAddr) {
        const existing = uniVals[addr];
        if (existing === void 0 || val > existing) {
          uniVals[addr] = val;
        }
      }
    }
    if (Object.keys(uniVals).length > 0) {
      dispatched.set(uniNum, uniVals);
    }
  }
  return dispatched;
}
function useDmxPlayback(options) {
  const { isPlaying, currentTimeRef, cues, patchedFixtures, fixtureDefs, universes, dmxOutputEnabled, tierMultipliers, strobeLimit = 10, colorFadeMs = 250, overrideCuesRef, fixtureTracksRef, efxTracksRef, effectsRef, fixtureGroupsRef, colorTracksRef, strobeTracksRef, dimmerTracksRef, chaserTracksRef, chasersRef, scenesRef, onVirtualDmx, disabledFixturesRef, fixturePositionsRef, panTiltLimitsRef, dryRunMode = false, frozenRef, forceDropRef, arbiterSource } = options;
  const arbSource = arbiterSource ?? "quickshow";
  const cuesRef = (0, import_react2.useRef)(cues);
  cuesRef.current = cues;
  const dmxEnabledRef = (0, import_react2.useRef)(dmxOutputEnabled);
  dmxEnabledRef.current = dmxOutputEnabled;
  const dryRunRef = (0, import_react2.useRef)(dryRunMode);
  dryRunRef.current = dryRunMode;
  (0, import_react2.useEffect)(() => {
    dmxBridge.setDryRun(dryRunMode);
  }, [dryRunMode]);
  (0, import_react2.useEffect)(() => {
    if (!dryRunMode) return;
    const api = typeof window !== "undefined" ? window.lightMaestro?.dmx : null;
    if (!api) return;
    api.stop().catch(() => {
    });
  }, [dryRunMode]);
  const lastChannelsRef = (0, import_react2.useRef)(/* @__PURE__ */ new Map());
  const freezerRef = (0, import_react2.useRef)(frozenRef);
  freezerRef.current = frozenRef;
  const forceDropRefLocal = (0, import_react2.useRef)(forceDropRef);
  forceDropRefLocal.current = forceDropRef;
  const patchedFixturesRef = (0, import_react2.useRef)(patchedFixtures);
  patchedFixturesRef.current = patchedFixtures;
  const analysisRef = (0, import_react2.useRef)(null);
  (0, import_react2.useEffect)(() => {
    if (patchedFixtures.length === 0 || universes.length === 0) {
      analysisRef.current = null;
      return;
    }
    const uniIds = universes.map((u) => String(u.id));
    const analyses = [];
    for (const pf of patchedFixtures) {
      const def = fixtureDefs.get(pf.fixtureDefId);
      if (!def) {
        console.warn(`[DMX-PLAYBACK] fixture "${pf.name}" sans d\xE9finition (fixtureDefId="${pf.fixtureDefId}") \u2014 ignor\xE9e pour la lecture`);
        continue;
      }
      const fa = analyzeChannels(pf, def);
      fa.universeIndex = uniIds.indexOf(pf.universeId);
      if (fa.universeIndex < 0) fa.universeIndex = 0;
      analyses.push(fa);
    }
    const byUniverse = /* @__PURE__ */ new Map();
    for (const fa of analyses) {
      const list = byUniverse.get(fa.universeIndex) ?? [];
      list.push(fa);
      byUniverse.set(fa.universeIndex, list);
    }
    const prev = analysisRef.current;
    const newKey = JSON.stringify({ uniIds, counts: analyses.map((a) => a.fixture.id) });
    if (prev?._key !== newKey) {
      analysisRef.current = { byUniverse, uniIds, _key: newKey };
    }
  }, [patchedFixtures, fixtureDefs, universes]);
  const engineStartedRef = (0, import_react2.useRef)(false);
  (0, import_react2.useEffect)(() => {
    const api = typeof window !== "undefined" ? window.lightMaestro?.dmx : null;
    if (!api || universes.length === 0) return;
    if (dryRunRef.current) return;
    let cancelled = false;
    (async () => {
      try {
        if (await api.isRunning().catch(() => false)) {
          engineStartedRef.current = true;
          return;
        }
        await Promise.all(universes.map((u) => api.addUniverse({
          id: u.id,
          name: u.name,
          type: u.type || "usb-dmx",
          output: true,
          input: false,
          channels: u.channels || 512,
          serialPort: u.serialPort || "",
          artnetIP: u.artnetIP || "",
          artnetSubnet: u.artnetSubnet ?? 0,
          artnetUniverse: u.artnetUniverse ?? 0,
          sacnUniverse: u.sacnUniverse ?? 1,
          sacnPriority: u.sacnPriority ?? 100
        }).catch(() => {
        })));
        if (cancelled) return;
        await api.start().catch(() => {
        });
        engineStartedRef.current = true;
      } catch {
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  const rafRef = (0, import_react2.useRef)(0);
  const hasPlayedRef = (0, import_react2.useRef)(false);
  (0, import_react2.useEffect)(() => {
    if (!isPlaying) {
      if (hasPlayedRef.current && dmxEnabledRef.current) {
        hasPlayedRef.current = false;
        const api2 = typeof window !== "undefined" ? window.lightMaestro?.dmx : null;
        const savedChannels = lastChannelsRef.current;
        if (savedChannels.size > 0 && api2) {
          const fadeStart = performance.now() / 1e3;
          const fadeDuration = 0.2;
          const tickFade = (now) => {
            const elapsed = now / 1e3 - fadeStart;
            if (elapsed >= fadeDuration) {
              for (let uniIdx = 0; uniIdx < universes.length; uniIdx++) {
                const black = {};
                for (let ch = 1; ch <= 512; ch++) black[ch] = 0;
                useAppStore.getState().setUniverseData(uniIdx, black);
                dmxBridge.push(uniIdx, black, arbSource);
                if (onVirtualDmx) onVirtualDmx(uniIdx, black);
              }
              return;
            }
            const t = elapsed / fadeDuration;
            const factor = 1 - t * t;
            for (const [uniIdx, channels] of savedChannels.entries()) {
              const faded = {};
              for (const chStr in channels) {
                const ch = Number(chStr);
                const val = channels[chStr];
                faded[Number(ch)] = Math.round(Number(val) * factor);
              }
              useAppStore.getState().setUniverseData(uniIdx, faded);
              dmxBridge.push(uniIdx, faded, arbSource);
              if (onVirtualDmx) onVirtualDmx(uniIdx, faded);
            }
            requestAnimationFrame(tickFade);
          };
          requestAnimationFrame(tickFade);
        } else {
          for (let uniIdx = 0; uniIdx < universes.length; uniIdx++) {
            const black = {};
            for (let ch = 1; ch <= 512; ch++) black[ch] = 0;
            useAppStore.getState().setUniverseData(uniIdx, black);
            dmxBridge.push(uniIdx, black, arbSource);
            if (onVirtualDmx) onVirtualDmx(uniIdx, black);
          }
        }
      }
      return;
    }
    hasPlayedRef.current = true;
    const api = typeof window !== "undefined" ? window.lightMaestro?.dmx : null;
    if (!api && !dryRunRef.current) return;
    console.warn(
      "[DMX-PLAYBACK] lecture d\xE9marr\xE9e \u2014",
      "dryRun=" + dryRunRef.current,
      "dmxOutput=" + dmxEnabledRef.current,
      "api=" + !!api,
      "cues=" + (cuesRef.current?.length ?? -1),
      "analysis=" + (analysisRef.current ? "ok" : "NULL"),
      "universes=" + universes.length,
      "fixtures=" + patchedFixtures.length
    );
    if (!engineStartedRef.current && !dryRunRef.current) {
      engineStartedRef.current = true;
      (async () => {
        try {
          if (await api.isRunning().catch(() => false)) return;
          await Promise.all(universes.map((u) => api.addUniverse({
            id: u.id,
            name: u.name,
            type: u.type || "usb-dmx",
            output: true,
            input: false,
            channels: u.channels || 512,
            serialPort: u.serialPort || "",
            artnetIP: u.artnetIP || "",
            artnetSubnet: u.artnetSubnet ?? 0,
            artnetUniverse: u.artnetUniverse ?? 0,
            sacnUniverse: u.sacnUniverse ?? 1,
            sacnPriority: u.sacnPriority ?? 100
          }).catch(() => {
          })));
          await api.start().catch(() => {
          });
        } catch {
        }
      })();
    }
    const movementPhase = Math.random() * 1e3;
    let lastSig = 0;
    let lastStoreUpdate = 0;
    const fadeState = /* @__PURE__ */ new Map();
    const FADE_ALPHA = colorFadeMs > 0 ? 1 - Math.exp(Math.log(0.1) / (colorFadeMs / 16.67)) : 0.98;
    const tick = () => {
      if (!dmxEnabledRef.current) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      const ct = currentTimeRef.current;
      const c = cuesRef.current;
      const analysis = analysisRef.current;
      if (!analysis || c.length === 0) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      tick._engineRecheck = (tick._engineRecheck ?? 119) + 1;
      if (tick._engineRecheck >= 120) {
        tick._engineRecheck = 0;
        if (dryRunRef.current) return;
        (async () => {
          try {
            const a = window.lightMaestro?.dmx;
            if (!a) return;
            if (!await a.isRunning().catch(() => false)) {
              await a.start().catch(() => {
              });
            }
          } catch {
          }
        })();
      }
      recordAudioTick();
      if (freezerRef.current?.current) {
        const lastCh = lastChannelsRef.current;
        if (lastCh.size > 0) {
          for (const [uId, chMap] of lastCh) {
            const uIdx = analysis.uniIds.indexOf(String(uId));
            if (uIdx < 0) continue;
            const cpy = { ...chMap };
            dmxBridge.push(uId, cpy, arbSource);
            if (onVirtualDmx) onVirtualDmx(uId, { ...cpy });
          }
        }
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      const fixturePositions = fixturePositionsRef?.current;
      const panTiltLimits = panTiltLimitsRef?.current ?? { pan: 128, tilt: 128 };
      const ctRefData = colorTracksRef?.current || [];
      const colorTrackColors = computeColorTrackColors(
        ctRefData,
        ct,
        patchedFixturesRef.current,
        fixtureGroupsRef?.current || []
      );
      const _diagFrame2 = tick._ctDiagFrame ?? 0;
      tick._ctDiagFrame = _diagFrame2 + 1;
      if (_diagFrame2 % 120 === 0 && ctRefData.length > 0) {
        for (const ctItem of ctRefData) {
          const activeEntry = ctItem.entries.find((e) => ct >= e.time && ct < e.endTime);
          console.log(`[colorTrack] "${ctItem.name}" targets=${ctItem.targetFixtures?.type} entries=${ctItem.entries.length} activeAt=${ct.toFixed(1)}: ${activeEntry ? `${activeEntry.color}\u2192${activeEntry.endColor || "N/A"} [${activeEntry.time.toFixed(1)}-${activeEntry.endTime.toFixed(1)}]` : "\u2205"}`);
        }
        const armId = patchedFixturesRef.current.find((f) => f.name?.includes("6 arm"))?.id;
        if (armId) {
          console.log(`[colorTrack] Tonio 6 arm (${armId}) hasColorTrack: ${colorTrackColors.has(armId)} \u2192 ${colorTrackColors.get(armId) || "\u2205"}`);
        }
      }
      let active = null;
      for (const cue of c) {
        if (cue.time <= ct && (!active || cue.time > active.time)) active = cue;
      }
      const sec = active?.section?.toLowerCase() ?? "verse";
      let fadeFactor = 1;
      if (!active) {
        if (analysis) {
          for (const [uniIdx] of analysis.byUniverse.entries()) {
            const uid = analysis.uniIds[uniIdx];
            if (!uid) continue;
            const zeroCh = {};
            for (let ch = 1; ch <= 512; ch++) zeroCh[ch] = 0;
            useAppStore.getState().setUniverseData(uniIdx, zeroCh);
            dmxBridge.push(uniIdx, zeroCh, arbSource);
            if (onVirtualDmx) onVirtualDmx(uniIdx, zeroCh);
          }
        }
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      if (c.length > 0 && ct > c[c.length - 1].time) {
        const fadeDuration = 1;
        const elapsed = ct - c[c.length - 1].time;
        if (elapsed >= fadeDuration) {
          if (analysis) {
            for (const [uniIdx] of analysis.byUniverse.entries()) {
              const uid = analysis.uniIds[uniIdx];
              if (!uid) continue;
              const zeroCh = {};
              for (let ch = 1; ch <= 512; ch++) zeroCh[ch] = 0;
              useAppStore.getState().setUniverseData(uniIdx, zeroCh);
              dmxBridge.push(uniIdx, zeroCh, arbSource);
              if (onVirtualDmx) onVirtualDmx(uniIdx, zeroCh);
            }
          }
          rafRef.current = requestAnimationFrame(tick);
          return;
        }
        const t = elapsed / fadeDuration;
        fadeFactor = 1 - t * t;
      }
      let nextCue = null;
      let crossfadeT = 0;
      for (const cue of c) {
        if (cue.time > ct && (!nextCue || cue.time < nextCue.time)) nextCue = cue;
      }
      let nextCueDmx = null;
      if (nextCue && active) {
        const gap = nextCue.time - active.time;
        if (gap > 0 && gap < 0.3) {
          const window2 = Math.min(0.15, gap * 0.5);
          const start = nextCue.time - window2;
          if (ct >= start) {
            crossfadeT = Math.min(1, (ct - start) / window2);
          }
        }
      }
      const strobeOverridesEarly = strobeTracksRef?.current && strobeTracksRef.current.length > 0 ? computeStrobeTrackOverrides(strobeTracksRef.current, ct, patchedFixturesRef.current, fixtureGroupsRef?.current || []) : null;
      if (crossfadeT > 0 && nextCue) {
        try {
          nextCueDmx = computeDmxForCue(
            nextCue,
            patchedFixturesRef.current,
            fixtureDefs,
            universes,
            tierMultipliers,
            void 0,
            colorTrackColors,
            strobeOverridesEarly,
            void 0,
            disabledFixturesRef?.current,
            fixturePositions
          );
        } catch (e) {
          crossfadeT = 0;
          nextCueDmx = null;
          console.warn("[crossfade] computeDmxForCue failed, skipping:", e);
        }
      }
      const energy = active.energy ?? (active.intensity === "very-high" ? 0.95 : active.intensity === "high" ? 0.8 : active.intensity === "medium" ? 0.5 : active.intensity === "low" ? 0.25 : 0.1);
      let dropBoost = 0;
      if (forceDropRefLocal.current?.current) {
        dropBoost = 0.95;
        forceDropRefLocal.current.current = false;
        setTimeout(() => {
          dropBoost = 0;
        }, 300);
      }
      const effectiveEnergy = dropBoost > 0 ? dropBoost : energy;
      const isDrop = sec === "drop" || dropBoost > 0;
      const isChorus = sec === "chorus";
      const forcedStrobe = dropBoost > 0 ? true : active.forcedStrobe;
      let efxActive = null;
      let efxTime = 0;
      if (overrideCuesRef?.current) {
        for (const oc of overrideCuesRef.current) {
          if (oc.time <= ct && oc.time >= efxTime) {
            efxTime = oc.time;
            efxActive = oc.channelValues;
          }
        }
      }
      const efxPtOverrides = efxTracksRef?.current && effectsRef?.current && efxTracksRef.current.length > 0 ? computeEfxOverrides(efxTracksRef.current, ct, effectsRef.current, patchedFixturesRef.current, fixtureGroupsRef?.current || []) : null;
      if (!efxPtOverrides || efxPtOverrides.size === 0) {
        if (efxTracksRef?.current && efxTracksRef.current.length > 0 && effectsRef?.current && effectsRef.current.length > 0) {
          const hasEntries = efxTracksRef.current.some((t) => t.entries.length > 0);
          if (hasEntries) {
          }
        }
      }
      const efxMap = efxActive || {};
      const dimmerOverrides = dimmerTracksRef?.current && dimmerTracksRef.current.length > 0 ? computeDimmerTrackOverrides(dimmerTracksRef.current, ct, patchedFixturesRef.current, fixtureGroupsRef?.current || []) : null;
      const strobeOverrides = strobeOverridesEarly;
      const fixtureTrackTargets = [];
      if (fixtureTracksRef?.current && fixtureGroupsRef?.current) {
        for (const ft of fixtureTracksRef.current) {
          if (!ft.enabled) {
            fixtureTrackTargets.push({ ft, targets: [] });
            continue;
          }
          fixtureTrackTargets.push({ ft, targets: resolveTrackTargets(ft, patchedFixturesRef.current, fixtureGroupsRef.current) });
        }
      }
      const fixtureTrackMap = /* @__PURE__ */ new Map();
      for (const entry of fixtureTrackTargets) {
        if (entry.targets.length === 0) continue;
        for (const fid of entry.targets) {
          if (!fixtureTrackMap.has(fid)) fixtureTrackMap.set(fid, []);
          fixtureTrackMap.get(fid).push(entry);
        }
      }
      for (const [uniIdx, fixtures] of analysis.byUniverse.entries()) {
        const uid = analysis.uniIds[uniIdx];
        if (!uid) continue;
        const chVals = {};
        for (let fi = 0; fi < fixtures.length; fi++) {
          const fa = fixtures[fi];
          const pf = fa.fixture;
          if (disabledFixturesRef?.current?.has(pf.id)) continue;
          let dimmerVal = (() => {
            const ftEntries = fixtureTrackMap.get(pf.id);
            if (ftEntries) {
              for (const { ft } of ftEntries) {
                const activeBlock = ft.dimmerBlocks.find((b) => ct >= b.time && ct < b.endTime);
                if (activeBlock) {
                  let val = activeBlock.value;
                  if (activeBlock.endValue !== void 0 && activeBlock.endValue !== activeBlock.value) {
                    const dur = activeBlock.endTime - activeBlock.time;
                    const t = dur > 0 ? (ct - activeBlock.time) / dur : 0;
                    val = Math.round(activeBlock.value + (activeBlock.endValue - activeBlock.value) * t);
                  }
                  return val;
                }
              }
            }
            return active.forcedDimmerVal !== void 0 ? active.forcedDimmerVal : mapIntensity(active.intensity, effectiveEnergy, pf.tier, tierMultipliers);
          })();
          if (dimmerOverrides) {
            const dimmerOverride = dimmerOverrides.get(pf.id);
            if (dimmerOverride) {
              dimmerVal = Math.round(255 * dimmerOverride.value / 100);
            }
          }
          const _dimmerTrackActive = !!(dimmerOverrides && dimmerOverrides.get(pf.id));
          if (fa.intensityOffset !== null) {
            const addr = pf.startAddress + fa.intensityOffset;
            if (_dimmerTrackActive) {
              chVals[addr] = dimmerVal;
            } else if (!chVals[addr] || dimmerVal > chVals[addr]) chVals[addr] = dimmerVal;
          }
          let paletteColor = (() => {
            if (colorTrackColors.has(pf.id)) {
              return colorTrackColors.get(pf.id);
            }
            const ftEntries2 = fixtureTrackMap.get(pf.id);
            if (ftEntries2) {
              for (const { ft } of ftEntries2) {
                const activeBlock = ft.colorBlocks.find((b) => ct >= b.time && ct < b.endTime);
                if (activeBlock) {
                  if (activeBlock.endColor && activeBlock.endColor !== activeBlock.color) {
                    const dur = activeBlock.endTime - activeBlock.time;
                    const t = dur > 0 ? (ct - activeBlock.time) / dur : 0;
                    const sr = parseInt(activeBlock.color.slice(1, 3), 16);
                    const sg = parseInt(activeBlock.color.slice(3, 5), 16);
                    const sb = parseInt(activeBlock.color.slice(5, 7), 16);
                    const er = parseInt(activeBlock.endColor.slice(1, 3), 16);
                    const eg = parseInt(activeBlock.endColor.slice(3, 5), 16);
                    const eb = parseInt(activeBlock.endColor.slice(5, 7), 16);
                    const rr = Math.round(sr + (er - sr) * t);
                    const rg = Math.round(sg + (eg - sg) * t);
                    const rb = Math.round(sb + (eb - sb) * t);
                    return "#" + [rr, rg, rb].map((v) => v.toString(16).padStart(2, "0")).join("");
                  }
                  return activeBlock.color;
                }
              }
            }
            if (active.colors.length > 0) {
              return active.forcedColor || active.color || active.colors[0] || void 0;
            }
            return active.forcedColor || active.color || void 0;
          })();
          const isColorTrack = colorTrackColors.has(pf.id);
          if (fa.rgbSegments.length > 0 && paletteColor) {
            let [r, g, b] = hexToRgb(paletteColor);
            if (!isColorTrack) {
              [r, g, b] = applyHueShift([r, g, b], TIER_HUE[pf.tier]);
              const grayVal = Math.round(r * 0.299 + g * 0.587 + b * 0.114);
              if (effectiveEnergy < 0.3) {
                const desat = 1 - effectiveEnergy * 3;
                r = Math.round(r + (grayVal - r) * desat);
                g = Math.round(g + (grayVal - g) * desat);
                b = Math.round(b + (grayVal - b) * desat);
                if (!isDrop && !isChorus) {
                  r = Math.round(r * (1 - (0.3 - effectiveEnergy) * 0.8));
                  b = Math.min(255, Math.round(b * (1 + (0.3 - effectiveEnergy) * 0.5)));
                }
              } else if (effectiveEnergy > 0.6) {
                const boost = (effectiveEnergy - 0.6) * 0.4;
                r = Math.min(255, Math.round(r + (r - grayVal) * boost * 2.5));
                g = Math.min(255, Math.round(g + (g - grayVal) * boost * 2.5));
                b = Math.min(255, Math.round(b + (b - grayVal) * boost * 2.5));
              }
            }
            for (const po of fa.presetOverrideOffsets) {
              chVals[pf.startAddress + po] = 0;
            }
            if (fa.intensityOffset !== null) {
              const addr = pf.startAddress + fa.intensityOffset;
              if (!chVals[addr] || dimmerVal > chVals[addr]) chVals[addr] = dimmerVal;
            }
            for (const seg of fa.rgbSegments) {
              const key = pf.id + "_" + seg.r;
              let cur = fadeState.get(key);
              if (!cur) {
                cur = { r, g, b };
                fadeState.set(key, cur);
              } else {
                cur.r = Math.round(cur.r + (r - cur.r) * FADE_ALPHA);
                cur.g = Math.round(cur.g + (g - cur.g) * FADE_ALPHA);
                cur.b = Math.round(cur.b + (b - cur.b) * FADE_ALPHA);
              }
              chVals[pf.startAddress + seg.r] = cur.r;
              chVals[pf.startAddress + seg.g] = cur.g;
              chVals[pf.startAddress + seg.b] = cur.b;
              if (seg.w !== null) chVals[pf.startAddress + seg.w] = 0;
            }
            if (fa.intensityOffset === null) {
              const dScale = dimmerVal / 255;
              for (const seg of fa.rgbSegments) {
                chVals[pf.startAddress + seg.r] = Math.round((chVals[pf.startAddress + seg.r] ?? 0) * dScale);
                chVals[pf.startAddress + seg.g] = Math.round((chVals[pf.startAddress + seg.g] ?? 0) * dScale);
                chVals[pf.startAddress + seg.b] = Math.round((chVals[pf.startAddress + seg.b] ?? 0) * dScale);
                if (seg.w !== null) chVals[pf.startAddress + seg.w] = Math.round((chVals[pf.startAddress + seg.w] ?? 0) * dScale);
              }
            }
          } else if (fa.wheelOffset !== null && paletteColor) {
            const caps = fa.wheelCaps;
            let wheelVal;
            if (caps.length > 0) {
              const bestCap = findBestWheelCap(caps, paletteColor);
              wheelVal = bestCap ? Math.round((bestCap.min + bestCap.max) / 2) : (() => {
                const [r, g, b] = hexToRgb(paletteColor);
                const cat2 = classifyColor(r, g, b);
                const catMap = { red: 0.1, orange: 0.2, yellow: 0.3, green: 0.42, cyan: 0.55, blue: 0.68, magenta: 0.78, purple: 0.78, white: 0.02 };
                const wPos = catMap[cat2] ?? 0.5;
                const capIdx = Math.floor(wPos * caps.length) % caps.length;
                return Math.round((caps[capIdx].min + caps[capIdx].max) / 2);
              })();
            } else {
              const [r, g, b] = hexToRgb(paletteColor);
              const cat2 = classifyColor(r, g, b);
              const catMap = { red: 0.1, orange: 0.2, yellow: 0.3, green: 0.42, cyan: 0.55, blue: 0.68, magenta: 0.78, purple: 0.78, white: 0.02 };
              const wPos = catMap[cat2] ?? 0.5;
              wheelVal = Math.round(wPos * 255);
            }
            chVals[pf.startAddress + fa.wheelOffset] = wheelVal;
          }
          const _diagFrame = tick._armDiagFrame ?? 0;
          tick._armDiagFrame = _diagFrame + 1;
          if (_diagFrame % 120 === 0 && pf.name?.includes("6 arm")) {
            const isCT = colorTrackColors.has(pf.id);
            console.log(
              `[dmx-out] Tonio 6 arm | source=${isCT ? "colorTrack" : "cue"} palette=${paletteColor || "\u2205"} dimmer=${dimmerVal}`,
              `| rgbSegments=${fa.rgbSegments.length > 0 ? fa.rgbSegments.map((s) => `R${pf.startAddress + s.r}=${chVals[pf.startAddress + s.r] ?? 0} G${pf.startAddress + s.g}=${chVals[pf.startAddress + s.g] ?? 0} B${pf.startAddress + s.b}=${chVals[pf.startAddress + s.b] ?? 0}`).join("; ") : "\u2205"}`
            );
          }
          if (fa.shutterOffset !== null) {
            const sAddr = pf.startAddress + fa.shutterOffset;
            const strobeTrackOverride = strobeOverrides ? strobeOverrides.get(pf.id) || null : null;
            const trackStrobe = (() => {
              const ftEntries3 = fixtureTrackMap.get(pf.id);
              if (ftEntries3) {
                for (const { ft } of ftEntries3) {
                  const activeBlock = ft.strobeBlocks.find((b) => ct >= b.time && ct < b.endTime);
                  if (activeBlock) {
                    let speed = activeBlock.speed;
                    if (activeBlock.endSpeed && activeBlock.endSpeed !== activeBlock.speed) {
                      const dur = activeBlock.endTime - activeBlock.time;
                      const t = dur > 0 ? (ct - activeBlock.time) / dur : 0;
                      speed = activeBlock.speed + (activeBlock.endSpeed - activeBlock.speed) * t;
                    }
                    return { active: true, speed };
                  }
                }
              }
              return null;
            })();
            const useStrobe = strobeTrackOverride ? strobeTrackOverride.active : trackStrobe ? trackStrobe.active : forcedStrobe !== void 0 ? forcedStrobe : (isDrop || isChorus) && active.strobe && pf.tier === "primary";
            if (useStrobe) {
              const sectionMult = isDrop ? 1.5 : isChorus ? 1.2 : sec === "build" ? 1.3 : sec === "bridge" ? 1 : sec === "verse" ? 0.8 : 0.5;
              const baseSpeed = Math.min(strobeTrackOverride?.speed || trackStrobe?.speed || active.strobeSpeed || 10, strobeLimit);
              const adaptedSpeed = Math.min(baseSpeed * sectionMult, strobeLimit);
              if (strobeTrackOverride) {
                const strobePhase = Math.sin(ct * Math.PI * 2 * adaptedSpeed);
                chVals[sAddr] = strobePhase >= 0 ? 255 : 0;
              } else if (fa.intensityOffset !== null && !trackStrobe) {
                const pulse = 0.5 + 0.5 * Math.sin(ct * Math.PI * 2 * adaptedSpeed);
                const iAddr = pf.startAddress + fa.intensityOffset;
                if (!chVals[iAddr] || Math.round(dimmerVal * pulse) > chVals[iAddr]) chVals[iAddr] = Math.round(dimmerVal * pulse);
                chVals[sAddr] = 255;
              } else {
                const strobePhase = Math.sin(ct * Math.PI * 2 * adaptedSpeed);
                chVals[sAddr] = strobePhase >= 0 ? 255 : 0;
              }
            } else if (fa.intensityOffset === null) {
              chVals[sAddr] = Math.max(8, Math.min(255, 8 + Math.round(dimmerVal / 255 * 247)));
            } else {
              chVals[sAddr] = 255;
            }
          }
          if (fa.shutterOffset === null) {
            const strobeTrackOverride = strobeOverrides ? strobeOverrides.get(pf.id) || null : null;
            const trackStrobeNoShutter = (() => {
              const ftEntriesNS = fixtureTrackMap.get(pf.id);
              if (ftEntriesNS) {
                for (const { ft } of ftEntriesNS) {
                  const activeBlockNS = ft.strobeBlocks.find((b) => ct >= b.time && ct < b.endTime);
                  if (activeBlockNS) return { active: true, speed: activeBlockNS.speed || 10 };
                }
              }
              return null;
            })();
            const useStrobeNoShutter = strobeTrackOverride ? strobeTrackOverride.active : trackStrobeNoShutter ? trackStrobeNoShutter.active : forcedStrobe !== void 0 ? forcedStrobe : (isDrop || isChorus) && active.strobe && pf.tier === "primary";
            if (useStrobeNoShutter && fa.intensityOffset !== null) {
              const baseSpeedNS = Math.min(strobeTrackOverride?.speed || trackStrobeNoShutter?.speed || active.strobeSpeed || 10, strobeLimit);
              const sectionMultNS = isDrop ? 1.5 : isChorus ? 1.2 : sec === "build" ? 1.3 : sec === "bridge" ? 1 : sec === "verse" ? 0.8 : 0.5;
              const adaptedSpeedNS = Math.min(baseSpeedNS * sectionMultNS, strobeLimit);
              const strobePhaseNS = Math.sin(ct * Math.PI * 2 * adaptedSpeedNS);
              const iAddrNS = pf.startAddress + fa.intensityOffset;
              chVals[iAddrNS] = strobePhaseNS >= 0 ? dimmerVal : 0;
            }
          }
          const panCount = fa.panOffsets.length;
          const tiltCount = fa.tiltOffsets.length;
          const motorCount = Math.max(panCount, tiltCount, 1);
          if (panCount > 0 || tiltCount > 0) {
            let efxPan = NaN, efxTilt = NaN;
            if (panCount > 0) {
              const pa = pf.startAddress + fa.panOffsets[0];
              if (efxMap[pa] !== void 0) efxPan = efxMap[pa];
            }
            if (tiltCount > 0) {
              const ta = pf.startAddress + fa.tiltOffsets[0];
              if (efxMap[ta] !== void 0) efxTilt = efxMap[ta];
            }
            if (!isNaN(efxPan) || !isNaN(efxTilt)) {
              for (let m = 0; m < motorCount; m++) {
                if (m < panCount) chVals[pf.startAddress + fa.panOffsets[m]] = isNaN(efxPan) ? 128 : efxPan;
                if (m < tiltCount) chVals[pf.startAddress + fa.tiltOffsets[m]] = isNaN(efxTilt) ? 128 : efxTilt;
              }
            } else if (efxPtOverrides?.has(pf.id)) {
              const ept = efxPtOverrides.get(pf.id);
              for (let m = 0; m < motorCount; m++) {
                if (m < panCount) chVals[pf.startAddress + fa.panOffsets[m]] = ept.pan;
                if (m < tiltCount) chVals[pf.startAddress + fa.tiltOffsets[m]] = ept.tilt;
              }
            } else {
              const trackMovement = (() => {
                const ftEntries4 = fixtureTrackMap.get(pf.id);
                if (ftEntries4) {
                  for (const { ft } of ftEntries4) {
                    const activeBlock = ft.movementBlocks.find((b) => ct >= b.time && ct < b.endTime);
                    if (activeBlock) return activeBlock;
                  }
                }
                return null;
              })();
              const amplitude = trackMovement ? trackMovement.amplitude : active.movementAmplitude !== void 0 ? Math.min(128, Math.max(0, Math.round(active.movementAmplitude))) : pf.tier === "primary" ? 90 : pf.tier === "secondary" ? 70 : 40;
              const movPattern = (() => {
                if (trackMovement) return trackMovement.pattern;
                const cueMov = active.movement;
                if (cueMov) {
                  const explicitPatterns = /* @__PURE__ */ new Set(["sweep", "circle", "bounce", "wave", "figure8", "zigzag", "diamond", "spiral", "heartbeat", "randomWalk", "panOnly", "tiltOnly", "static", "pulse"]);
                  if (!explicitPatterns.has(cueMov)) {
                    let mobileIdx2 = -1, totalMobile2 = 0;
                    for (const ffa of fixtures) {
                      if (ffa.panOffsets.length > 0 || ffa.tiltOffsets.length > 0) {
                        if (ffa.fixture.id === pf.id) mobileIdx2 = totalMobile2;
                        totalMobile2++;
                      }
                    }
                    if (mobileIdx2 >= 0) return getSmartMovement(mobileIdx2, totalMobile2, cueMov, ct);
                    return cueMov;
                  }
                  return cueMov;
                }
                let mobileIdx = -1, totalMobile = 0;
                for (const ffa of fixtures) {
                  if (ffa.panOffsets.length > 0 || ffa.tiltOffsets.length > 0) {
                    if (ffa.fixture.id === pf.id) mobileIdx = totalMobile;
                    totalMobile++;
                  }
                }
                if (mobileIdx >= 0) {
                  return getSmartMovement(mobileIdx, totalMobile, sec, ct);
                }
                return sec;
              })();
              if (amplitude > 0) {
                for (let m = 0; m < motorCount; m++) {
                  const motorPhase = m * (Math.PI * 2 / motorCount);
                  const speedMult = active.movementSpeed ?? 1;
                  const curAmp = amplitude;
                  const curSpd = speedMult;
                  const blendAmp = crossfadeT > 0 && nextCue && !trackMovement ? Math.round(curAmp * (1 - crossfadeT) + (nextCue.movementAmplitude !== void 0 ? Math.min(128, Math.max(0, Math.round(nextCue.movementAmplitude))) : curAmp) * crossfadeT) : curAmp;
                  const blendSpd = crossfadeT > 0 && nextCue && !trackMovement ? curSpd * (1 - crossfadeT) + (nextCue.movementSpeed ?? curSpd) * crossfadeT : curSpd;
                  const phase = ct * Math.PI * 2 * blendSpd + motorPhase + movementPhase;
                  let px = 0, py = 0;
                  switch (movPattern) {
                    case "intro":
                      px = Math.sin(phase * 0.1) * 0.3;
                      py = Math.cos(phase * 0.08 + motorPhase) * 0.3;
                      break;
                    case "verse":
                      px = Math.sin(phase * 0.25) * 0.5;
                      py = Math.cos(phase * 0.2 + motorPhase) * 0.4;
                      break;
                    case "chorus":
                      px = Math.sin(phase * 0.5) * 0.7;
                      py = Math.cos(phase * 0.5 + motorPhase) * 0.7;
                      break;
                    case "bridge":
                      px = Math.sin(phase * 0.3) * 0.5;
                      py = Math.sin(phase * 0.6 + motorPhase) * 0.5;
                      break;
                    case "drop":
                      px = Math.sin(phase * 0.8) * 0.9;
                      py = Math.cos(phase * 1.2 + motorPhase) * 0.6;
                      break;
                    case "outro":
                      px = Math.sin(phase * 0.15) * 0.2;
                      py = Math.cos(phase * 0.12 + motorPhase) * 0.2;
                      break;
                    case "sweep":
                      px = Math.sin(phase * 0.35 + motorPhase) * 0.7;
                      py = Math.cos(phase * 0.3 + motorPhase) * 0.5;
                      break;
                    case "circle":
                      px = Math.sin(phase * 0.5 + motorPhase) * 0.7;
                      py = Math.cos(phase * 0.5 + motorPhase) * 0.7;
                      break;
                    case "bounce":
                      px = Math.sin(phase * 0.4 + motorPhase) * 0.5;
                      py = Math.abs(Math.sin(phase * 0.8 + motorPhase)) * 0.8;
                      break;
                    case "wave":
                      px = Math.sin(phase * 0.6 + motorPhase) * 0.5;
                      py = Math.sin(phase * 0.35 + motorPhase * 1.5) * 0.5;
                      break;
                    case "figure8":
                      px = Math.sin(phase * 0.4 + motorPhase) * 0.6;
                      py = Math.sin(phase * 0.8 + motorPhase) * 0.5;
                      break;
                    case "static":
                      px = Math.sin(phase * 0.05 + motorPhase) * 0.1;
                      py = Math.cos(phase * 0.05 + motorPhase) * 0.1;
                      break;
                    case "zigzag":
                      {
                        const saw = phase / Math.PI % 2 - 1;
                        px = saw * 0.8;
                        py = Math.sin(phase) > 0 ? 0.5 : -0.5;
                      }
                      break;
                    case "diamond":
                      {
                        px = (phase / Math.PI % 2 - 1) * 0.8;
                        py = ((phase + Math.PI / 2) / Math.PI % 2 - 1) * 0.8;
                      }
                      break;
                    case "spiral":
                      {
                        const r = 0.3 + 0.7 * Math.abs(Math.sin(phase * 0.3));
                        px = Math.sin(phase * 2) * r;
                        py = Math.cos(phase * 2) * r;
                      }
                      break;
                    case "heartbeat":
                      {
                        const hp = phase / (Math.PI * 2) % 1;
                        const hb = hp < 0.15 ? 1 : hp < 0.3 ? 0.6 : 0;
                        px = hb * Math.sin(phase * 3);
                        py = hb * Math.cos(phase * 3);
                      }
                      break;
                    case "randomWalk":
                      px = Math.sin(phase * 0.7) * 0.5 + Math.sin(phase * 1.3) * 0.3 + Math.cos(phase * 2.1) * 0.2;
                      py = Math.cos(phase * 0.6) * 0.5 + Math.sin(phase * 1.7) * 0.3 + Math.sin(phase * 2.3) * 0.2;
                      break;
                    case "panOnly":
                      px = Math.sin(phase);
                      py = 0;
                      break;
                    case "tiltOnly":
                      px = 0;
                      py = Math.sin(phase);
                      break;
                    default:
                      px = Math.sin(phase * 0.35) * 0.4;
                      py = Math.cos(phase * 0.3 + motorPhase) * 0.4;
                  }
                  const pfl = panTiltLimits.perFixture?.[pf.id];
                  const panLimit = trackMovement ? 128 : pfl?.pan ?? panTiltLimits.pan;
                  const tiltLimit = trackMovement ? 128 : pfl?.tilt ?? panTiltLimits.tilt;
                  if (m < panCount) {
                    const raw = Math.max(0, Math.min(255, Math.round(128 + px * blendAmp)));
                    const fp = fixturePositions?.[pf.id];
                    let pv = fp ? clampPanToStage(raw, fp.x) : raw;
                    pv = Math.max(128 - panLimit, Math.min(128 + panLimit, pv));
                    chVals[pf.startAddress + fa.panOffsets[m]] = pv;
                  }
                  if (m < tiltCount) {
                    const raw = Math.max(0, Math.min(255, Math.round(128 + py * blendAmp)));
                    const fp = fixturePositions?.[pf.id];
                    let tv = fp ? clampTiltToStage(raw, fp.y) : raw;
                    tv = Math.max(128 - tiltLimit, Math.min(128 + tiltLimit, tv));
                    chVals[pf.startAddress + fa.tiltOffsets[m]] = tv;
                  }
                }
              } else {
                for (const po of fa.panOffsets) chVals[pf.startAddress + po] = 128;
                for (const to of fa.tiltOffsets) chVals[pf.startAddress + to] = 128;
              }
            }
          }
          const fxEnergy = active.energy ?? 0.5;
          const fxPhase = ct * Math.PI * 2 * (active.movementSpeed ?? 1);
          if (fa.goboOffset !== null) {
            const gAddr = pf.startAddress + fa.goboOffset;
            if (fa.goboCaps.length > 0) {
              const gc = Math.max(1, fa.goboCaps.length);
              const gi = Math.floor(fxPhase * 0.5 % gc);
              chVals[gAddr] = Math.round((fa.goboCaps[gi].min + fa.goboCaps[gi].max) / 2);
            } else {
              chVals[gAddr] = Math.round(fxEnergy * 255);
            }
          }
          if (fa.prismOffset !== null) {
            const pAddr = pf.startAddress + fa.prismOffset;
            chVals[pAddr] = Math.round(Math.max(0, Math.min(255, 64 + Math.sin(fxPhase * 0.7) * 128 * fxEnergy)));
          }
          if (fa.zoomOffset !== null) {
            const zAddr = pf.startAddress + fa.zoomOffset;
            chVals[zAddr] = Math.round(64 + Math.sin(fxPhase * 0.4) * 96 * fxEnergy + 64 * fxEnergy);
          }
          if (fa.frostOffset !== null) {
            const fAddr = pf.startAddress + fa.frostOffset;
            chVals[fAddr] = Math.round(Math.max(0, 255 - fxEnergy * 255));
          }
          if (fa.irisOffset !== null) {
            const iAddr = pf.startAddress + fa.irisOffset;
            chVals[iAddr] = Math.round(40 + fxEnergy * 200 + Math.sin(fxPhase * 0.5) * 15 * fxEnergy);
          }
          if (fa.focusOffset !== null) {
            const fcAddr = pf.startAddress + fa.focusOffset;
            chVals[fcAddr] = Math.round(80 + fxEnergy * 120 + Math.sin(fxPhase * 0.3) * 30);
          }
          if (fa.isLaser) {
            computeLaserChannels(fa, pf, chVals, ct, effectiveEnergy, paletteColor);
          }
        }
        if (chaserTracksRef?.current && chasersRef?.current && scenesRef?.current) {
          const _diagC = tick._chDiagFrame ?? 0;
          tick._chDiagFrame = _diagC + 1;
          try {
            const chaserCtl = computeChaserTrackOverrides(
              chaserTracksRef.current,
              chasersRef.current,
              scenesRef.current,
              ct,
              patchedFixturesRef.current,
              fixtureGroupsRef?.current || []
            );
            if (_diagC % 120 === 0 && chaserTracksRef.current.length > 0) {
              for (const tr of chaserTracksRef.current) {
                const activeEntry = tr.entries.find((e) => ct >= e.time && ct < e.endTime);
                console.log(`[chaserTrack] "${tr.name}" entries=${tr.entries.length} activeAt=${ct.toFixed(1)}: ${activeEntry ? `chaser=${activeEntry.chaserName || activeEntry.chaserId} [${activeEntry.time.toFixed(1)}-${activeEntry.endTime.toFixed(1)}] controls=${chaserCtl.size} fixtures` : "\u2205"}`);
              }
            }
            if (chaserCtl.size > 0) {
              for (const fa of fixtures) {
                const pfx = fa.fixture;
                const cmap = chaserCtl.get(pfx.id);
                if (!cmap) continue;
                for (let a = pfx.startAddress; a < pfx.startAddress + pfx.channelCount; a++) {
                  if (chVals[a] !== void 0) delete chVals[a];
                }
                for (const addrStr in cmap) {
                  const v = cmap[addrStr];
                  const addr = Number(addrStr);
                  if (addr >= pfx.startAddress && addr < pfx.startAddress + pfx.channelCount) chVals[addr] = v;
                }
              }
            }
          } catch (e) {
            console.error("[chaserTrack] takeover error:", e);
          }
        }
        if (crossfadeT > 0 && nextCueDmx) {
          const nextUni = nextCueDmx.find((n) => n.universe === uniIdx);
          if (nextUni) {
            const nextCh = nextUni.channelValues;
            const existing = new Set(Object.keys(chVals));
            for (const chStr of Object.keys(nextCh)) {
              const ch = Number(chStr);
              chVals[ch] = existing.has(chStr) ? Math.round(chVals[ch] * (1 - crossfadeT) + nextCh[ch] * crossfadeT) : Math.round(nextCh[ch] * crossfadeT);
            }
          }
        }
        if (fadeFactor < 1) {
          for (const chStr in chVals) {
            chVals[Number(chStr)] = Math.round(chVals[Number(chStr)] * fadeFactor);
          }
        }
        {
          let hasVals = false;
          for (const _ in chVals) {
            hasVals = true;
            break;
          }
          if (hasVals) {
            let sig = uniIdx;
            for (const chStr in chVals) {
              sig = sig * 31 + Number(chStr) * 17 + chVals[chStr] | 0;
            }
            if (sig !== lastSig) {
              lastSig = sig;
              const now = performance.now();
              if (now - lastStoreUpdate > 33) {
                useAppStore.getState().setUniverseData(uniIdx, chVals);
                lastStoreUpdate = now;
              }
              dmxBridge.push(uniIdx, chVals, arbSource);
              if (onVirtualDmx) onVirtualDmx(uniIdx, chVals);
              lastChannelsRef.current.set(uniIdx, { ...chVals });
            }
          }
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(rafRef.current);
    };
  }, [isPlaying]);
}
function computeLaserChannels(fa, pf, chVals, laserT, energy, paletteColor, options) {
  const laserPhase = pf.startAddress % 16 / 16 * 2 * Math.PI;
  const lissajous = pf.startAddress % 3 === 2;
  const laserRadius = 60 + Math.round(energy * 40);
  if (fa.laserModeOffset !== null) {
    chVals[pf.startAddress + fa.laserModeOffset] = capMid(pickLaserModeCap(fa.laserModeCaps));
  }
  if (fa.patternOffset !== null && fa.patternCaps.length > 0) {
    const idx = Math.floor(laserT / 2) % fa.patternCaps.length;
    chVals[pf.startAddress + fa.patternOffset] = capMid(fa.patternCaps[idx]);
  }
  if (fa.scanXOffset !== null) {
    chVals[pf.startAddress + fa.scanXOffset] = Math.round(128 + laserRadius * Math.sin(2 * Math.PI * laserT + laserPhase));
  }
  if (fa.scanYOffset !== null) {
    const yv = lissajous ? Math.sin(4 * Math.PI * laserT + laserPhase) : Math.cos(2 * Math.PI * laserT + laserPhase);
    chVals[pf.startAddress + fa.scanYOffset] = Math.round(128 + laserRadius * yv);
  }
  if (fa.laserColorMode === "wheel" && fa.wheelOffset !== null && fa.wheelCaps.length > 0 && chVals[pf.startAddress + fa.wheelOffset] === void 0) {
    const idx = Math.floor(laserT / 2) % fa.wheelCaps.length;
    chVals[pf.startAddress + fa.wheelOffset] = capMid(fa.wheelCaps[idx]);
  }
  if (fa.rgbOffsets && fa.rgbSegments.length === 0 && chVals[pf.startAddress + fa.rgbOffsets[0]] === void 0) {
    const [rr0, gg0, bb0] = paletteColor ? hexToRgb(paletteColor) : [Math.round(255 * energy), Math.round(255 * energy), 0];
    let rr = laserGateValue(rr0), gg = laserGateValue(gg0), bb = laserGateValue(bb0);
    const pairClosed = (fa.rgbOffsets[0] !== void 0 ? rr === 0 : true) && (fa.rgbOffsets[1] !== void 0 ? gg === 0 : true) && (fa.rgbOffsets[2] !== void 0 ? bb === 0 : true);
    if (pairClosed && (rr0 > 22 || gg0 > 22 || bb0 > 22)) {
      rr = 255;
      gg = 255;
    }
    if (fa.rgbOffsets[0] !== void 0) chVals[pf.startAddress + fa.rgbOffsets[0]] = rr;
    if (fa.rgbOffsets[1] !== void 0) chVals[pf.startAddress + fa.rgbOffsets[1]] = gg;
    if (fa.rgbOffsets[2] !== void 0) chVals[pf.startAddress + fa.rgbOffsets[2]] = bb;
  }
  if (fa.laserColorMode === "gate" && fa.laserColorGateOffset !== null && chVals[pf.startAddress + fa.laserColorGateOffset] === void 0) {
    const colorCaps = fa.laserColorGateCaps.filter(
      (c) => /(red|green|blue|amber|cyan|magenta|yellow|white)/i.test(c.name ?? "") && !/blackout|off|closed|none/i.test(c.name ?? "")
    );
    let target;
    if (paletteColor) {
      const [rr, gg, bb] = hexToRgb(paletteColor);
      target = colorCaps.find((c) => rr > 122 && /red/i.test(c.name) || gg > 122 && /green/i.test(c.name) || bb > 122 && /blue/i.test(c.name)) ?? colorCaps[0];
    } else {
      target = colorCaps[0];
    }
    if (target) chVals[pf.startAddress + fa.laserColorGateOffset] = capMid(target);
  }
  if (fa.laserSpeedScanOffset !== null) {
    chVals[pf.startAddress + fa.laserSpeedScanOffset] = Math.min(127, Math.round(128 + 60 * Math.sin(2 * Math.PI * laserT + laserPhase)));
  }
  if (fa.laserSpeedPatternOffset !== null) {
    chVals[pf.startAddress + fa.laserSpeedPatternOffset] = Math.round(128 + 64 * Math.sin(2 * Math.PI * laserT / 4));
  }
  fa.laserRotationOffsets.forEach((off, i) => {
    chVals[pf.startAddress + off] = Math.round(128 + 65 * Math.sin(2 * Math.PI * laserT / (4 * (i + 1)) + laserPhase));
  });
  if (fa.blankOffset !== null) {
    chVals[pf.startAddress + fa.blankOffset] = options?.blankWhenStrobe ? 255 : 0;
  }
}
function computeDmxForCue(cue, patchedFixtures, fixtureDefs, universes, tierMultipliers, fixtureTrackOverrides, colorTrackColors, strobeTrackOverrides, dimmerTrackOverrides, disabledFixtures, fixturePositions, chaserTakeover) {
  const uniIds = universes.map((u) => String(u.id));
  const analyses = [];
  for (const pf of patchedFixtures) {
    const def = fixtureDefs.get(pf.fixtureDefId);
    const fa = analyzeChannels(pf, def);
    fa.universeIndex = uniIds.indexOf(pf.universeId);
    if (fa.universeIndex < 0) fa.universeIndex = 0;
    analyses.push(fa);
  }
  const byUniverse = /* @__PURE__ */ new Map();
  for (const fa of analyses) {
    const list = byUniverse.get(fa.universeIndex) ?? [];
    list.push(fa);
    byUniverse.set(fa.universeIndex, list);
  }
  const energy = cue.energy ?? (cue.intensity === "very-high" ? 0.95 : cue.intensity === "high" ? 0.8 : cue.intensity === "medium" ? 0.5 : cue.intensity === "low" ? 0.25 : 0.1);
  const isDrop = cue.section.toLowerCase() === "drop";
  const isChorus = cue.section.toLowerCase() === "chorus";
  const sec = cue.section.toLowerCase();
  const results = [];
  for (const [uniIdx, fixtures] of byUniverse.entries()) {
    const chVals = {};
    for (let fi = 0; fi < fixtures.length; fi++) {
      const fa = fixtures[fi];
      const pf = fa.fixture;
      if (disabledFixtures?.has(pf.id)) continue;
      let dimmerVal = fixtureTrackOverrides?.forcedDimmers?.has(pf.id) ? fixtureTrackOverrides.forcedDimmers.get(pf.id) : mapIntensity(cue.intensity, energy, pf.tier, tierMultipliers);
      if (dimmerTrackOverrides) {
        const dimmerOverride = dimmerTrackOverrides.get(pf.id);
        if (dimmerOverride) {
          dimmerVal = Math.round(255 * dimmerOverride.value / 100);
        }
      }
      if (fa.intensityOffset !== null) {
        const addr = pf.startAddress + fa.intensityOffset;
        if (!chVals[addr] || dimmerVal > chVals[addr]) chVals[addr] = dimmerVal;
      }
      let paletteColor = colorTrackColors?.has(pf.id) ? colorTrackColors.get(pf.id) : fixtureTrackOverrides?.forcedColors?.has(pf.id) ? fixtureTrackOverrides.forcedColors.get(pf.id) : (() => {
        return cue.forcedColor || cue.color || cue.colors?.[0] || void 0;
      })();
      if (fa.rgbSegments.length > 0 && paletteColor) {
        let [r, g, b] = hexToRgb(paletteColor);
        if (!colorTrackColors?.has(pf.id)) {
          [r, g, b] = applyHueShift([r, g, b], TIER_HUE[pf.tier]);
        }
        for (const po of fa.presetOverrideOffsets) {
          chVals[pf.startAddress + po] = 0;
        }
        for (const seg of fa.rgbSegments) {
          chVals[pf.startAddress + seg.r] = r;
          chVals[pf.startAddress + seg.g] = g;
          chVals[pf.startAddress + seg.b] = b;
          if (seg.w !== null) chVals[pf.startAddress + seg.w] = 0;
        }
        if (fa.intensityOffset === null) {
          const dScale = dimmerVal / 255;
          for (const seg of fa.rgbSegments) {
            chVals[pf.startAddress + seg.r] = Math.round((chVals[pf.startAddress + seg.r] ?? 0) * dScale);
            chVals[pf.startAddress + seg.g] = Math.round((chVals[pf.startAddress + seg.g] ?? 0) * dScale);
            chVals[pf.startAddress + seg.b] = Math.round((chVals[pf.startAddress + seg.b] ?? 0) * dScale);
            if (seg.w !== null) chVals[pf.startAddress + seg.w] = Math.round((chVals[pf.startAddress + seg.w] ?? 0) * dScale);
          }
        }
      } else if (fa.wheelOffset !== null && paletteColor) {
        const caps = fa.wheelCaps;
        let wheelVal;
        if (caps.length > 0) {
          const bestCap = findBestWheelCap(caps, paletteColor);
          wheelVal = bestCap ? Math.round((bestCap.min + bestCap.max) / 2) : (() => {
            const [r, g, b] = hexToRgb(paletteColor);
            const cat2 = classifyColor(r, g, b);
            const catMap = { red: 0.1, orange: 0.2, yellow: 0.3, green: 0.42, cyan: 0.55, blue: 0.68, magenta: 0.78, purple: 0.78, white: 0.02 };
            const wPos = catMap[cat2] ?? 0.5;
            const capIdx = Math.floor(wPos * caps.length) % caps.length;
            return Math.round((caps[capIdx].min + caps[capIdx].max) / 2);
          })();
        } else {
          const [r, g, b] = hexToRgb(paletteColor);
          const cat2 = classifyColor(r, g, b);
          const catMap = { red: 0.1, orange: 0.2, yellow: 0.3, green: 0.42, cyan: 0.55, blue: 0.68, magenta: 0.78, purple: 0.78, white: 0.02 };
          const wPos = catMap[cat2] ?? 0.5;
          wheelVal = Math.round(wPos * 255);
        }
        chVals[pf.startAddress + fa.wheelOffset] = wheelVal;
      }
      if (fa.shutterOffset !== null) {
        const sAddr = pf.startAddress + fa.shutterOffset;
        const strobeTrackStrobe = strobeTrackOverrides?.get(pf.id);
        const trackStrobe = fixtureTrackOverrides?.forcedStrobes?.get(pf.id);
        const useStrobe = strobeTrackStrobe ? strobeTrackStrobe.active : trackStrobe ? trackStrobe.active : cue.forcedStrobe !== void 0 ? cue.forcedStrobe : (isDrop || isChorus) && cue.strobe && pf.tier === "primary";
        if (useStrobe) {
          const speed = Math.min(strobeTrackStrobe?.speed || trackStrobe?.speed || cue.strobeSpeed || 10, 10);
          chVals[sAddr] = Math.min(131, 16 + Math.floor(speed * 11));
        } else if (fa.intensityOffset === null) {
          chVals[sAddr] = Math.max(8, Math.min(255, 8 + Math.round(dimmerVal / 255 * 247)));
        } else {
          chVals[sAddr] = 255;
        }
      }
      const panCount = fa.panOffsets.length;
      const tiltCount = fa.tiltOffsets.length;
      const motorCount = Math.max(panCount, tiltCount, 1);
      if (panCount > 0 || tiltCount > 0) {
        const trackMovement = fixtureTrackOverrides?.forcedMovements?.get(pf.id);
        const amplitude = trackMovement ? trackMovement.amplitude : cue.movementAmplitude !== void 0 ? Math.min(128, Math.max(0, Math.round(cue.movementAmplitude))) : pf.tier === "primary" ? 90 : pf.tier === "secondary" ? 70 : 40;
        if (amplitude > 0) {
          const speedMult = cue.movementSpeed ?? 1;
          const phase = cue.time * Math.PI * 2 * speedMult;
          for (let m = 0; m < motorCount; m++) {
            const motorPhase = m * (Math.PI * 2 / motorCount);
            const movSec = (() => {
              if (trackMovement) return trackMovement.pattern;
              const cueMov = cue.movement;
              if (cueMov) {
                const explicitPatterns = /* @__PURE__ */ new Set(["sweep", "circle", "bounce", "wave", "figure8", "zigzag", "diamond", "spiral", "heartbeat", "randomWalk", "panOnly", "tiltOnly", "static", "pulse"]);
                if (!explicitPatterns.has(cueMov)) {
                  let mobileIdx2 = -1, totalMobile2 = 0;
                  for (const a of analyses) {
                    if (a.panOffsets.length > 0 || a.tiltOffsets.length > 0) {
                      if (a.fixture.id === pf.id) mobileIdx2 = totalMobile2;
                      totalMobile2++;
                    }
                  }
                  if (mobileIdx2 >= 0) return getSmartMovement(mobileIdx2, totalMobile2, cueMov, cue.time);
                  return cueMov;
                }
                return cueMov;
              }
              let mobileIdx = -1, totalMobile = 0;
              for (const a of analyses) {
                if (a.panOffsets.length > 0 || a.tiltOffsets.length > 0) {
                  if (a.fixture.id === pf.id) mobileIdx = totalMobile;
                  totalMobile++;
                }
              }
              if (mobileIdx >= 0) return getSmartMovement(mobileIdx, totalMobile, sec, cue.time);
              return sec;
            })();
            let px = 0, py = 0;
            switch (movSec) {
              case "intro":
                px = Math.sin(phase * 0.1) * 0.3;
                py = Math.cos(phase * 0.08 + motorPhase) * 0.3;
                break;
              case "verse":
                px = Math.sin(phase * 0.25) * 0.5;
                py = Math.cos(phase * 0.2 + motorPhase) * 0.4;
                break;
              case "chorus":
                px = Math.sin(phase * 0.5) * 0.7;
                py = Math.cos(phase * 0.5 + motorPhase) * 0.7;
                break;
              case "bridge":
                px = Math.sin(phase * 0.3) * 0.5;
                py = Math.sin(phase * 0.6 + motorPhase) * 0.5;
                break;
              case "drop":
                px = Math.sin(phase * 0.8) * 0.9;
                py = Math.cos(phase * 1.2 + motorPhase) * 0.6;
                break;
              case "outro":
                px = Math.sin(phase * 0.15) * 0.2;
                py = Math.cos(phase * 0.12 + motorPhase) * 0.2;
                break;
              case "sweep":
                px = Math.sin(phase * 0.35 + motorPhase) * 0.7;
                py = Math.cos(phase * 0.3 + motorPhase) * 0.5;
                break;
              case "circle":
                px = Math.sin(phase * 0.5 + motorPhase) * 0.7;
                py = Math.cos(phase * 0.5 + motorPhase) * 0.7;
                break;
              case "bounce":
                px = Math.sin(phase * 0.4 + motorPhase) * 0.5;
                py = Math.abs(Math.sin(phase * 0.8 + motorPhase)) * 0.8;
                break;
              case "wave":
                px = Math.sin(phase * 0.6 + motorPhase) * 0.5;
                py = Math.sin(phase * 0.35 + motorPhase * 1.5) * 0.5;
                break;
              case "figure8":
                px = Math.sin(phase * 0.4 + motorPhase) * 0.6;
                py = Math.sin(phase * 0.8 + motorPhase) * 0.5;
                break;
              case "static":
                px = Math.sin(phase * 0.05 + motorPhase) * 0.1;
                py = Math.cos(phase * 0.05 + motorPhase) * 0.1;
                break;
              case "zigzag":
                {
                  const saw = phase / Math.PI % 2 - 1;
                  px = saw * 0.8;
                  py = Math.sin(phase) > 0 ? 0.5 : -0.5;
                }
                break;
              case "diamond":
                {
                  px = (phase / Math.PI % 2 - 1) * 0.8;
                  py = ((phase + Math.PI / 2) / Math.PI % 2 - 1) * 0.8;
                }
                break;
              case "spiral":
                {
                  const r = 0.3 + 0.7 * Math.abs(Math.sin(phase * 0.3));
                  px = Math.sin(phase * 2) * r;
                  py = Math.cos(phase * 2) * r;
                }
                break;
              case "heartbeat":
                {
                  const hp = phase / (Math.PI * 2) % 1;
                  const hb = hp < 0.15 ? 1 : hp < 0.3 ? 0.6 : 0;
                  px = hb * Math.sin(phase * 3);
                  py = hb * Math.cos(phase * 3);
                }
                break;
              case "randomWalk":
                px = Math.sin(phase * 0.7) * 0.5 + Math.sin(phase * 1.3) * 0.3 + Math.cos(phase * 2.1) * 0.2;
                py = Math.cos(phase * 0.6) * 0.5 + Math.sin(phase * 1.7) * 0.3 + Math.sin(phase * 2.3) * 0.2;
                break;
              case "panOnly":
                px = Math.sin(phase);
                py = 0;
                break;
              case "tiltOnly":
                px = 0;
                py = Math.sin(phase);
                break;
              default:
                px = Math.sin(phase * 0.35) * 0.5;
                py = Math.cos(phase * 0.3 + motorPhase) * 0.5;
            }
            if (m < panCount) {
              const raw = Math.max(0, Math.min(255, Math.round(128 + px * amplitude)));
              const fp = fixturePositions?.[pf.id];
              chVals[pf.startAddress + fa.panOffsets[m]] = fp ? clampPanToStage(raw, fp.x) : raw;
            }
            if (m < tiltCount) {
              const raw = Math.max(0, Math.min(255, Math.round(128 + py * amplitude)));
              const fp = fixturePositions?.[pf.id];
              chVals[pf.startAddress + fa.tiltOffsets[m]] = fp ? clampTiltToStage(raw, fp.y) : raw;
            }
          }
        } else {
          for (const po of fa.panOffsets) chVals[pf.startAddress + po] = 128;
          for (const to of fa.tiltOffsets) chVals[pf.startAddress + to] = 128;
        }
      }
      const fxEnergy = cue.energy ?? 0.5;
      const fxPhase = cue.time * Math.PI * 2 * (cue.movementSpeed ?? 1);
      if (fa.goboOffset !== null) {
        const gAddr = pf.startAddress + fa.goboOffset;
        if (fa.goboCaps.length > 0) {
          const goboCount = Math.max(1, fa.goboCaps.length);
          const goboIdx = Math.floor(fxPhase * 0.5 % goboCount);
          chVals[gAddr] = Math.round((fa.goboCaps[goboIdx].min + fa.goboCaps[goboIdx].max) / 2);
        } else {
          chVals[gAddr] = Math.round(fxEnergy * 255);
        }
      }
      if (fa.prismOffset !== null) {
        chVals[pf.startAddress + fa.prismOffset] = Math.round(Math.max(0, Math.min(255, 64 + Math.sin(fxPhase * 0.7) * 128 * fxEnergy)));
      }
      if (fa.zoomOffset !== null) {
        chVals[pf.startAddress + fa.zoomOffset] = Math.round(64 + Math.sin(fxPhase * 0.4) * 96 * fxEnergy + 64 * fxEnergy);
      }
      if (fa.frostOffset !== null) {
        chVals[pf.startAddress + fa.frostOffset] = Math.round(Math.max(0, 255 - fxEnergy * 255));
      }
      if (fa.irisOffset !== null) {
        chVals[pf.startAddress + fa.irisOffset] = Math.round(40 + fxEnergy * 200 + Math.sin(fxPhase * 0.5) * 15 * fxEnergy);
      }
      if (fa.focusOffset !== null) {
        chVals[pf.startAddress + fa.focusOffset] = Math.round(80 + fxEnergy * 120 + Math.sin(fxPhase * 0.3) * 30);
      }
      if (fa.isLaser) {
        computeLaserChannels(fa, pf, chVals, cue.time, energy, paletteColor, {
          blankWhenStrobe: (isDrop || isChorus) && !!cue.strobe
        });
      }
    }
    if (chaserTakeover && chaserTakeover.size > 0) {
      for (const fa of fixtures) {
        const pf = fa.fixture;
        const cmap = chaserTakeover.get(pf.id);
        if (!cmap) continue;
        for (let a = pf.startAddress; a < pf.startAddress + pf.channelCount; a++) {
          if (chVals[a] !== void 0) delete chVals[a];
        }
        for (const addrStr in cmap) {
          const v = cmap[addrStr];
          const addr = Number(addrStr);
          if (addr >= pf.startAddress && addr < pf.startAddress + pf.channelCount) chVals[addr] = v;
        }
      }
    }
    results.push({ universe: uniIdx, channelValues: chVals });
  }
  return results.filter((r) => Object.keys(r.channelValues).length > 0);
}
var import_react2;
var init_dmx_playback = __esm({
  "src/hooks/dmx-playback.ts"() {
    import_react2 = __toESM(require_react());
    init_fixture_tracks();
    init_dmx_color();
    init_fixture_analyzer();
    init_dmx_movement();
    init_appStore();
    init_dmx_bridge();
    init_latency_meter();
  }
});

// .cluster/coverage-generic/audit.ts
var fs3 = __toESM(require("fs"));
var path3 = __toESM(require("path"));

// electron/fixtures/library.ts
var import_fs2 = __toESM(require("fs"));
var import_path2 = __toESM(require("path"));
var import_xml2js2 = require("xml2js");
var import_electron = require("electron");

// electron/fixtures/gdtf.ts
var import_fs = __toESM(require("fs"));
var import_path = __toESM(require("path"));
var import_zlib = __toESM(require("zlib"));
var import_xml2js = require("xml2js");
function normalizeAttr(a) {
  return a.toLowerCase().replace(/_/g, "");
}
var GDTF_EXACT_TYPE = {
  dimmer: "Intensity",
  // additive emitters
  coloraddr: "Colour",
  coloraddg: "Colour",
  coloraddb: "Colour",
  coloraddc: "Colour",
  coloraddm: "Colour",
  coloraddy: "Colour",
  coloraddw: "Colour",
  coloraddww: "Colour",
  coloraddcw: "Colour",
  coloradduv: "Colour",
  coloraddlime: "Colour",
  coloraddamber: "Colour",
  coloraddindigo: "Colour",
  // subtractive flags
  colorsubc: "Colour",
  colorsubm: "Colour",
  colorsuby: "Colour",
  // indirect RGB / HSB
  colorrgbred: "Colour",
  colorrgbgreen: "Colour",
  colorrgbblue: "Colour",
  hsbhue: "Colour",
  hsbsaturation: "Colour",
  hsbbrightness: "Colour",
  // colour temperature correction
  cto: "Colour",
  ctb: "Colour",
  ctc: "Colour",
  // position
  pan: "Pan",
  tilt: "Tilt",
  panrotate: "Pan",
  tiltrotate: "Tilt",
  // beam
  zoom: "Beam",
  iris: "Beam",
  beamshaper: "Beam",
  zoommode: "Beam",
  zoommodespot: "Beam",
  zoommodebeam: "Beam",
  // speed / effect / control
  pantiltspeed: "Speed",
  pantiltmode: "Effect",
  panmode: "Effect",
  tiltmode: "Effect",
  effectspeed: "Speed",
  effectduration: "Speed",
  strobemode: "Shutter",
  colorwheel: "Colour",
  colorwheelspin: "Speed",
  colorwheelrotation: "Speed",
  // no function
  nofeature: "Nothing"
};
function gdtfAttributeToType(attr) {
  if (!attr) return "Nothing";
  const n = normalizeAttr(attr);
  if (GDTF_EXACT_TYPE[n]) return GDTF_EXACT_TYPE[n];
  if (/^gobo/.test(n)) return "Gobo";
  if (/^color\d/.test(n)) return "Colour";
  if (/^shutter/.test(n)) return "Shutter";
  if (/^strobe/.test(n)) return "Shutter";
  if (/^prism/.test(n)) return "Prism";
  if (/^frost/.test(n)) return "Beam";
  if (/^focus/.test(n)) return "Beam";
  if (/^effects/.test(n)) return "Effect";
  if (/^(control|lampcontrol)/.test(n)) return "Maintenance";
  return "Nothing";
}
function parseDmxValue(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  const m = /^(\d+)\/(\d+)(s)?$/.exec(s);
  if (!m) return null;
  let value = parseInt(m[1], 10);
  let byteCount = parseInt(m[2], 10) || 1;
  if (m[3] === "s") {
    value = value << 8 * byteCount;
    byteCount += 1;
  }
  return { value, byteCount };
}
function toCoarse(value, byteCount) {
  if (byteCount <= 1) return Math.max(0, Math.min(255, Math.round(value)));
  const coarse = Math.floor(value / Math.pow(256, byteCount - 1));
  return Math.max(0, Math.min(255, coarse));
}
function channelMax(byteCount) {
  return Math.pow(256, byteCount) - 1;
}
function parseOffset(raw) {
  if (raw == null) return { slots: [], byteCount: 0 };
  const s = String(raw).trim();
  if (!s || s === "None") return { slots: [], byteCount: 0 };
  const slots = s.split(",").map((x) => parseInt(x, 10)).filter((n) => Number.isFinite(n));
  return { slots, byteCount: slots.length };
}
var GDTF_COLOR_MAP = {
  red: "#ff0000",
  green: "#00ff00",
  blue: "#0000ff",
  white: "#ffffff",
  black: "#000000",
  yellow: "#ffff00",
  cyan: "#00ffff",
  magenta: "#ff00ff",
  orange: "#ff8000",
  amber: "#ffbf00",
  purple: "#8000ff",
  pink: "#ff80c0",
  uv: "#8000ff",
  lime: "#00ff00",
  "warm white": "#ffe4b5",
  "cold white": "#f0f8ff",
  "neutral white": "#f5f5dc",
  lavender: "#e6e6fa",
  turquoise: "#40e0d0"
};
function colorHexFromName(name) {
  if (!name) return void 0;
  const lower = name.toLowerCase().trim();
  if (GDTF_COLOR_MAP[lower]) return GDTF_COLOR_MAP[lower];
  for (const [key, hex] of Object.entries(GDTF_COLOR_MAP)) {
    if (lower.includes(key)) return hex;
  }
  return void 0;
}
var GEOMETRY_TAGS = [
  "Geometry",
  "Axis",
  "FilterBeam",
  "FilterColor",
  "FilterGobo",
  "FilterShaper",
  "Beam",
  "MediaServerLayer",
  "MediaServerCamera",
  "MediaServerMaster",
  "Display",
  "GeometryReference",
  "Laser",
  "WiringObject",
  "Inventory",
  "Structure",
  "Support",
  "Magnet"
];
function collectGeometries(geoSection, names, kinds) {
  if (!geoSection) return;
  for (const tag of GEOMETRY_TAGS) {
    const list = geoSection[tag];
    if (!list) continue;
    const arr = Array.isArray(list) ? list : [list];
    for (const g of arr) {
      if (g && g.$ && g.$.Name) names.add(String(g.$.Name));
      kinds.add(tag.toLowerCase());
      collectGeometries(g, names, kinds);
    }
  }
}
function prettyAttr(attr, attrPretty) {
  const key = attr.toLowerCase();
  if (attrPretty.has(key)) return attrPretty.get(key);
  const prettified = attr.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2").trim();
  return prettified || attr;
}
function extractAuthor(ft) {
  const rev = ft.Revisions?.[0]?.Revision;
  const revList = rev ? Array.isArray(rev) ? rev : [rev] : [];
  for (const r of revList) {
    if (r?.$?.ModifiedBy) return String(r.$.ModifiedBy);
  }
  return "GDTF Import";
}
function inferType(kinds, attrs) {
  if (kinds.has("laser")) return "Laser";
  const hasPan = attrs.has("pan") || attrs.has("panrotate");
  const hasTilt = attrs.has("tilt") || attrs.has("tiltrotate");
  const hasColor = [...attrs].some((a) => a.startsWith("color") || a === "cto" || a === "ctb" || a === "ctc" || a.startsWith("hsb"));
  const hasDimmer = attrs.has("dimmer");
  const hasStrobe = [...attrs].some((a) => a.startsWith("shutter") || a.startsWith("strobe"));
  if (hasPan && hasTilt) return "Moving Head";
  if (hasColor) return "Color Changer";
  if (hasStrobe) return "Strobe";
  if (hasDimmer) return "Dimmer";
  return "Other";
}
function buildCapabilities(lc, byteCount) {
  const caps = [];
  const maxVal = channelMax(byteCount);
  const cfList = lc?.ChannelFunction ? Array.isArray(lc.ChannelFunction) ? lc.ChannelFunction : [lc.ChannelFunction] : [];
  const cfStarts = cfList.map((cf) => parseDmxValue(cf?.$?.DMXFrom)?.value ?? 0);
  for (let fi = 0; fi < cfList.length; fi++) {
    const cf = cfList[fi];
    const cfStart = cfStarts[fi];
    const cfEnd = fi + 1 < cfList.length ? cfStarts[fi + 1] - 1 : maxVal;
    const csList = cf?.ChannelSet ? Array.isArray(cf.ChannelSet) ? cf.ChannelSet : [cf.ChannelSet] : [];
    if (csList.length === 0) {
      const cfName = cf?.$?.Name;
      if (cfName) {
        caps.push({ min: toCoarse(cfStart, byteCount), max: toCoarse(cfEnd, byteCount), name: String(cfName) });
      }
      continue;
    }
    const csStarts = csList.map((cs) => parseDmxValue(cs?.$?.DMXFrom)?.value ?? cfStart);
    for (let si = 0; si < csList.length; si++) {
      const cs = csList[si];
      const csStart = csStarts[si];
      const csEnd = si + 1 < csList.length ? csStarts[si + 1] - 1 : cfEnd;
      const name = cs?.$?.Name || "";
      if (!name) continue;
      const cap = {
        min: toCoarse(csStart, byteCount),
        max: toCoarse(csEnd, byteCount),
        name
      };
      const colorHex = colorHexFromName(name);
      if (colorHex) cap.color = colorHex;
      caps.push(cap);
    }
  }
  return caps;
}
async function parseGdtfXml(xml, opts) {
  try {
    const parsed = await (0, import_xml2js.parseStringPromise)(xml, { explicitArray: true, mergeAttrs: false });
    const gdtf = parsed?.GDTF;
    if (!gdtf) return null;
    const ft = Array.isArray(gdtf.FixtureType) ? gdtf.FixtureType[0] : gdtf.FixtureType;
    if (!ft) return null;
    const manufacturer = ft.$?.Manufacturer || "Unknown";
    const model = ft.$?.Name || ft.$?.ShortName || ft.$?.LongName || "Unknown";
    const author = extractAuthor(ft) || "GDTF Import";
    const attrPretty = /* @__PURE__ */ new Map();
    const attrList = ft.AttributeDefinitions?.[0]?.Attributes?.[0]?.Attribute;
    const attrs = attrList ? Array.isArray(attrList) ? attrList : [attrList] : [];
    for (const a of attrs) {
      if (a?.$?.Name) attrPretty.set(String(a.$.Name).toLowerCase(), String(a.$.Pretty || a.$.Name));
    }
    const geometryNames = /* @__PURE__ */ new Set();
    const geometryKinds = /* @__PURE__ */ new Set();
    collectGeometries(ft.Geometries?.[0], geometryNames, geometryKinds);
    const modes = [];
    const dmxModeList = ft.DMXModes?.[0]?.DMXMode;
    const modeList = dmxModeList ? Array.isArray(dmxModeList) ? dmxModeList : [dmxModeList] : [];
    const usedAttrs = /* @__PURE__ */ new Set();
    for (const mode of modeList) {
      const modeName = mode?.$?.Name || "Default";
      const rootGeo = mode?.$?.Geometry || "";
      const dmxChList = mode?.DMXChannels?.[0]?.DMXChannel;
      const chList = dmxChList ? Array.isArray(dmxChList) ? dmxChList : [dmxChList] : [];
      const raw = [];
      const geoInMode = /* @__PURE__ */ new Set();
      for (const ch of chList) {
        if (!ch) continue;
        const offset = parseOffset(ch.$?.Offset);
        if (offset.byteCount === 0) continue;
        const geo = ch.$?.Geometry || rootGeo || "";
        if (geo) geoInMode.add(geo);
        const lcList = ch.LogicalChannel ? Array.isArray(ch.LogicalChannel) ? ch.LogicalChannel : [ch.LogicalChannel] : [];
        const firstLc = lcList[0] || {};
        const attr = String(firstLc.$?.Attribute || firstLc.ChannelFunction?.[0]?.$?.Attribute || "NoFeature");
        const attrKey = normalizeAttr(attr);
        if (attrKey !== "nofeature" && attrKey) usedAttrs.add(attrKey);
        const chType = gdtfAttributeToType(attr);
        const chName = prettyAttr(attr, attrPretty);
        const dflt = parseDmxValue(ch.$?.Default ?? firstLc.ChannelFunction?.[0]?.$?.Default);
        const capabilities = buildCapabilities(firstLc, offset.byteCount);
        const coarseDefault = dflt ? toCoarse(dflt.value, dflt.byteCount || offset.byteCount) : 0;
        raw.push({
          slot: offset.slots[0],
          geo,
          channel: {
            name: chName,
            type: chType,
            defaultValue: coarseDefault,
            capabilities: capabilities.length > 0 ? capabilities : void 0
          }
        });
        if (offset.byteCount >= 2) {
          raw.push({
            slot: offset.slots[1],
            geo,
            channel: {
              name: `${chName} fine`,
              type: chType,
              defaultValue: dflt ? dflt.value & 255 : 0,
              capabilities: void 0
            }
          });
        }
      }
      raw.sort((a, b) => a.slot - b.slot);
      const multiGeo = geoInMode.size > 1;
      const channels = raw.map((r) => ({
        ...r.channel,
        name: multiGeo && r.geo ? `${r.geo}_${r.channel.name}` : r.channel.name
      }));
      modes.push({ name: modeName, channels });
    }
    const type = inferType(geometryKinds, usedAttrs);
    let id = `${manufacturer}-${model}`.replace(/\s+/g, "-").replace(/[^a-zA-Z0-9_-]/g, "");
    if (!id) {
      const ftid = String(ft.$?.FixtureTypeID || "").replace(/[^a-zA-Z0-9_-]/g, "");
      id = `gdtf-${ftid || "unknown"}`;
    }
    return {
      id,
      manufacturer,
      model,
      type,
      author,
      modes,
      qlcplusFile: opts?.sourceName
    };
  } catch (e) {
    console.warn("Failed to parse GDTF:", e);
    return null;
  }
}
function readZipEntry(zip, entryName) {
  try {
    const scanStart = Math.max(0, zip.length - 65557);
    let eocd = -1;
    for (let i = zip.length - 22; i >= scanStart; i--) {
      if (zip.readUInt32LE(i) === 101010256) {
        const commentLen = zip.readUInt16LE(i + 20);
        if (i + 22 + commentLen === zip.length) {
          eocd = i;
          break;
        }
      }
    }
    if (eocd < 0) return null;
    const entryCount = zip.readUInt16LE(eocd + 10);
    const cdOffset = zip.readUInt32LE(eocd + 16);
    if (entryCount === 65535 || cdOffset === 4294967295) {
      console.warn("ZIP read: Zip64 archives are not supported");
      return null;
    }
    let p = cdOffset;
    for (let i = 0; i < entryCount; i++) {
      if (zip.readUInt32LE(p) !== 33639248) return null;
      const method = zip.readUInt16LE(p + 10);
      const compSize = zip.readUInt32LE(p + 20);
      const nameLen = zip.readUInt16LE(p + 28);
      const extraLen = zip.readUInt16LE(p + 30);
      const commentLen = zip.readUInt16LE(p + 32);
      const localOffset = zip.readUInt32LE(p + 42);
      const name = zip.toString("utf8", p + 46, p + 46 + nameLen);
      if (name === entryName || name.endsWith("/" + entryName)) {
        if (zip.readUInt32LE(localOffset) !== 67324752) return null;
        const lhNameLen = zip.readUInt16LE(localOffset + 26);
        const lhExtraLen = zip.readUInt16LE(localOffset + 28);
        const dataStart = localOffset + 30 + lhNameLen + lhExtraLen;
        const data = zip.subarray(dataStart, dataStart + compSize);
        if (method === 0) return Buffer.from(data);
        if (method === 8) return import_zlib.default.inflateRawSync(data);
        return null;
      }
      p += 46 + nameLen + extraLen + commentLen;
    }
    return null;
  } catch (e) {
    console.warn("ZIP read failed:", e);
    return null;
  }
}
function readGdtfDescriptionXml(gdtfPath) {
  const buf = import_fs.default.readFileSync(gdtfPath);
  const entry = readZipEntry(buf, "description.xml");
  if (!entry) return null;
  return entry.toString("utf-8");
}
async function parseGdtfFile(gdtfPath) {
  const xml = readGdtfDescriptionXml(gdtfPath);
  if (!xml) return null;
  return parseGdtfXml(xml, { sourceName: import_path.default.basename(gdtfPath) });
}

// electron/fixtures/library.ts
var PRESET_TYPE_MAP = {
  // Intensity family
  IntensityDimmer: "Intensity",
  IntensityMasterDimmer: "Intensity",
  IntensityRed: "Colour",
  IntensityGreen: "Colour",
  IntensityBlue: "Colour",
  IntensityCyan: "Colour",
  IntensityMagenta: "Colour",
  IntensityYellow: "Colour",
  IntensityAmber: "Colour",
  IntensityWhite: "Colour",
  IntensityUV: "Colour",
  IntensityLime: "Colour",
  IntensityIndigo: "Colour",
  IntensityHue: "Colour",
  IntensitySaturation: "Colour",
  IntensityColorWheel: "Colour",
  IntensityColorMixMode: "Colour",
  // Position family
  PositionPan: "Pan",
  PositionTilt: "Tilt",
  PositionPanFine: "Pan",
  PositionTiltFine: "Tilt",
  PositionPanTiltSpeed: "Speed",
  PositionPanTiltMacro: "Effect",
  // Gobo family
  GoboWheel: "Gobo",
  GoboWheelSpin: "Gobo",
  GoboWheel2: "Gobo",
  GoboIndex: "Gobo",
  // Shutter/Strobe family
  ShutterOpen: "Shutter",
  ShutterClose: "Shutter",
  ShutterStrobe: "Shutter",
  StrobeSpeed: "Speed",
  StrobeSlowToFast: "Shutter",
  StrobeFreqRange: "Shutter",
  // Speed
  SpeedPanTilt: "Speed",
  SpeedColor: "Speed",
  SpeedGobo: "Speed",
  SpeedEffect: "Speed",
  // Prism
  Prism: "Prism",
  PrismRotation: "Prism",
  PrismMacro: "Prism",
  // Beam
  BeamZoom: "Beam",
  BeamFocus: "Beam",
  BeamFrost: "Beam",
  BeamIris: "Beam",
  BeamShaper: "Beam",
  // Effect
  EffectDimmer: "Effect",
  EffectSpeed: "Effect",
  // Maintenance
  Maintenance: "Maintenance"
};
function presetToType(preset) {
  if (!preset) return "Nothing";
  return PRESET_TYPE_MAP[preset] || "Nothing";
}
function groupToType(group) {
  if (!group) return "Nothing";
  const g = group.toLowerCase();
  if (g === "intensity") return "Intensity";
  if (g === "pan") return "Pan";
  if (g === "tilt") return "Tilt";
  if (g === "colour" || g === "color") return "Colour";
  if (g === "gobo") return "Gobo";
  if (g === "shutter") return "Shutter";
  if (g === "speed") return "Speed";
  if (g === "prism") return "Prism";
  if (g === "effect") return "Effect";
  if (g === "beam") return "Beam";
  if (g === "maintenance") return "Maintenance";
  return "Nothing";
}
var OFL_TYPE_MAP = {
  // Intensity family
  Intensity: "Intensity",
  ColorIntensity: "Colour",
  ColorPreset: "Colour",
  ColorTemperature: "Colour",
  // Position family
  Pan: "Pan",
  PanContinuous: "Pan",
  Tilt: "Tilt",
  TiltContinuous: "Tilt",
  // Fine variants (arrivent avec les updates GitHub OFL)
  PositionPanFine: "Pan",
  PositionTiltFine: "Tilt",
  // Speed
  PanTiltSpeed: "Speed",
  Speed: "Speed",
  EffectSpeed: "Speed",
  EffectDuration: "Speed",
  // Shutter / Strobe
  ShutterStrobe: "Shutter",
  StrobeDuration: "Shutter",
  StrobeSpeed: "Speed",
  // Prism
  Prism: "Prism",
  PrismRotation: "Prism",
  // Gobo family (types OFL plus récents)
  GoboWheel: "Gobo",
  GoboWheelRotation: "Gobo",
  GoboIndex: "Gobo",
  GoboStencil: "Gobo",
  GoboShake: "Gobo",
  // Beam
  BeamAngle: "Beam",
  BeamPosition: "Beam",
  Zoom: "Beam",
  Focus: "Beam",
  Frost: "Beam",
  FrostEffect: "Beam",
  Iris: "Beam",
  IrisEffect: "Beam",
  BladeInsertion: "Beam",
  BladeRotation: "Beam",
  BladeSystemRotation: "Beam",
  // Effect
  Effect: "Effect",
  EffectParameter: "Effect",
  Generic: "Effect",
  Fog: "Effect",
  FogOutput: "Effect",
  FogType: "Effect",
  // Maintenance
  Maintenance: "Maintenance",
  // Rotation (gobo rotation / prism rotation)
  Rotation: "Speed",
  // Catch-all
  NoFunction: "Nothing",
  SoundSensitivity: "Nothing",
  Time: "Nothing"
};
function oflCapTypeToChannelType(capType, channelName) {
  if (capType === "WheelSlot" || capType === "WheelRotation" || capType === "WheelShake" || capType === "WheelSlotRotation") {
    const lower = channelName.toLowerCase();
    if (lower.includes("color") || lower.includes("colour")) return "Colour";
    if (lower.includes("gobo")) return "Gobo";
    if (capType === "WheelRotation" || capType === "WheelShake") return "Colour";
    return "Gobo";
  }
  return OFL_TYPE_MAP[capType] || "Nothing";
}
function normalizeOflDefault(raw) {
  if (typeof raw === "string" && raw.endsWith("%")) {
    const pct = parseFloat(raw);
    if (Number.isFinite(pct)) return Math.round(pct / 100 * 255);
    return 0;
  }
  if (typeof raw === "number" && Number.isFinite(raw)) {
    if (raw > 255) return raw >> 8 & 255;
    if (raw >= 0) return Math.round(raw);
    return 0;
  }
  return 0;
}
var OFL_MANUFACTURER_MAP = {
  "5star-systems": "5Star Systems",
  "abstract": "Abstract",
  "acoustic-control": "Acoustic Control",
  "adb": "ADB",
  "afx": "AFX",
  "alien-pro": "Alien Pro",
  "american-dj": "American DJ",
  "ape-labs": "Ape Labs",
  "aputure": "Aputure",
  "arri": "ARRI",
  "astera": "Astera",
  "audibax": "Audibax",
  "ayra": "Ayra",
  "ayrton": "Ayrton",
  "beamz": "BeamZ",
  "big-dipper": "Big Dipper",
  "bitfocus": "Bitfocus",
  "blizzard": "Blizzard",
  "boomtonedj": "BoomToneDJ",
  "briteq": "Briteq",
  "cameo": "Cameo",
  "chauvet-dj": "Chauvet DJ",
  "chauvet-professional": "Chauvet Professional",
  "chroma-q": "Chroma-Q",
  "cinetec": "Cinetec",
  "clay-paky": "Clay Paky",
  "clf": "CLF",
  "coemar": "Coemar",
  "contest": "Contest",
  "dedolight": "Dedolight",
  "dts": "DTS",
  "dts-italy": "DTS Italy",
  "ect": "ECT",
  "elation": "Elation",
  "elektralite": "Elektralite",
  "eliminator": "Eliminator",
  "elumen8": "Eliminator",
  "equinox": "Equinox",
  "etc": "ETC",
  "eurolite": "Eurolite",
  "event-lighting": "Event Lighting",
  "expolite": "Expolite",
  "fos": "FOS",
  "futurelight": "Futurelight",
  "gantom": "Gantom",
  "ge-lighting": "GE Lighting",
  "glp": "GLP",
  "gls": "GLS",
  "gruppe": "Gruppe",
  "high-end-systems": "High End Systems",
  "hikari": "Hikari",
  "iluminarc": "Iluminarc",
  "img": "IMG Stageline",
  "jb-lighting": "JB Lighting",
  "jb-systems": "JB Systems",
  "kam": "KAM",
  "keslight": "KES Light",
  "laserworld": "Laserworld",
  "lcd": "LCD",
  "ledj": "LEDJ",
  "lightmaxx": "Lightmaxx",
  "lightpro": "LightPro",
  "lightsky": "Lightsky",
  "look-solutions": "Look Solutions",
  "lpg": "LPG",
  "lss": "LSS",
  "lth": "LTH",
  "luminus": "Luminus",
  "lutec": "Lutec",
  "macroleds": "MacroLEDs",
  "magicfx": "MagicFX",
  "marin": "Marin",
  "martin": "Martin",
  "martin-architectural": "Martin Architectural",
  "martin-rush": "Martin Rush",
  "mdg": "MDG",
  "mega-lite": "Mega Lite",
  "mega-systems": "Mega Systems",
  "minuit-une": "Minuit Une",
  "moleculaire": "Moleculaire",
  "music-hall": "Music Hall",
  "neo-neon": "Neo-Neon",
  "nicols": "Nicols",
  "omni-sistem": "OmniSistem",
  "optoma": "Optoma",
  "orlando": "Orlando",
  "orpheo": "Orpheo",
  "osram": "Osram",
  "philips": "Philips",
  "philips-hue": "Philips Hue",
  "pls": "PLS",
  "portman": "Portman",
  "power-spot": "Power Spot",
  "proel": "Proel",
  "prolight": "Prolight",
  "propar": "Propar",
  "qtx": "QTX",
  "renkforce": "Renkforce",
  "robe": "Robe",
  "robert-juliat": "Robert Juliat",
  "sagitter": "Sagitter",
  "seeburg": "Seeburg",
  "showtec": "Showtec",
  "smoke-factory": "Smoke Factory",
  "sony": "Sony",
  "sound-king": "Sound King",
  "spotlight": "Spotlight",
  "stairville": "Stairville",
  "steinigke": "Steinigke",
  "strand": "Strand",
  "sunrise": "Sunrise",
  "swisson": "Swisson",
  "teclec": "Teclec",
  "triton": "Triton",
  "ultratec": "Ultratec",
  "vari-lite": "Vari-Lite",
  "varytec": "Varytec",
  "venue": "Venue",
  "vmb": "VMB",
  "w-m-f-x": "W-M-F-X",
  "wolfmix": "Wolfmix",
  "x-laser": "X-Laser",
  "yellow-river": "Yellow River",
  "yuer": "Yuer"
};
function getAllFiles(dir, ...extensions) {
  const results = [];
  if (!import_fs2.default.existsSync(dir)) return results;
  const entries = import_fs2.default.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = import_path2.default.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...getAllFiles(fullPath, ...extensions));
    } else if (entry.isFile()) {
      const ext = import_path2.default.extname(entry.name).toLowerCase();
      if (extensions.includes(ext)) {
        results.push(fullPath);
      }
    }
  }
  return results;
}
function resolveBundledFixturesRoot() {
  const candidates = [
    import_path2.default.join(import_electron.app.getAppPath(), "resources", "fixtures"),
    import_path2.default.join(process.resourcesPath, "app", "resources", "fixtures")
  ];
  for (const p of candidates) {
    if (import_fs2.default.existsSync(p)) return p;
  }
  return candidates[0];
}
function logFixtureDiagnostic(msg) {
  try {
    const dir = import_path2.default.join(import_electron.app.getPath("userData"), "logs");
    import_fs2.default.mkdirSync(dir, { recursive: true });
    import_fs2.default.appendFileSync(import_path2.default.join(dir, "fixture-library.log"), `[${(/* @__PURE__ */ new Date()).toISOString()}] ${msg}
`);
  } catch {
  }
}
var FixtureLibrary = class _FixtureLibrary {
  fixtures = /* @__PURE__ */ new Map();
  searchIndex = [];
  normalizedKeys = /* @__PURE__ */ new Set();
  normalizedIdMap = /* @__PURE__ */ new Map();
  async load() {
    this.fixtures.clear();
    this.searchIndex = [];
    this.normalizedKeys.clear();
    this.normalizedIdMap.clear();
    this.budgetCache = null;
    const fixturesDir = resolveBundledFixturesRoot();
    logFixtureDiagnostic(
      `load start \u2014 packaged=${import_electron.app.isPackaged} appPath=${import_electron.app.getAppPath()} resourcesPath=${process.resourcesPath} fixturesDir=${fixturesDir} exists=${import_fs2.default.existsSync(fixturesDir)}`
    );
    if (import_fs2.default.existsSync(fixturesDir)) {
      await this.loadDirectory(fixturesDir);
    }
    const oflDir = import_path2.default.join(fixturesDir, "ofl");
    if (import_fs2.default.existsSync(oflDir)) {
      await this.loadOflDirectory(oflDir);
    }
    const gdtfDir = import_path2.default.join(fixturesDir, "gdtf");
    if (import_fs2.default.existsSync(gdtfDir)) {
      await this.loadGdtfDirectory(gdtfDir);
    }
    const userOflDir = import_path2.default.join(import_electron.app.getPath("userData"), "ofl-fixtures");
    if (import_fs2.default.existsSync(userOflDir)) {
      const result = await this.loadOflDirectory(userOflDir, { overwrite: true });
      if (result.added > 0) {
        console.log(`User data OFL: ${result.added} fixtures loaded (overrides bundled)`);
      }
    }
    const userGdtfDir = import_path2.default.join(import_electron.app.getPath("userData"), "gdtf-fixtures");
    import_fs2.default.mkdirSync(userGdtfDir, { recursive: true });
    const gdtfResult = await this.loadGdtfDirectory(userGdtfDir);
    if (gdtfResult.added > 0) {
      console.log(`User data GDTF: ${gdtfResult.added} fixtures loaded`);
    }
    const userFixturesDir = import_path2.default.join(import_electron.app.getPath("userData"), "fixtures");
    if (import_fs2.default.existsSync(userFixturesDir)) {
      await this.loadDirectory(userFixturesDir);
    }
    console.log(`Fixture library loaded: ${this.fixtures.size} fixtures`);
    logFixtureDiagnostic(`load done \u2014 fixtures=${this.fixtures.size}`);
    return this.fixtures.size;
  }
  async loadDirectory(dir) {
    const files = getAllFiles(dir, ".qxf", ".json");
    for (const file of files) {
      try {
        const content = import_fs2.default.readFileSync(file, "utf-8");
        if (file.endsWith(".qxf")) {
          const def = await this.parseQLC(content, file);
          if (def) this.add(def);
        } else {
          const def = JSON.parse(content);
          this.add(def);
        }
      } catch (e) {
        console.warn(`Failed to load fixture ${import_path2.default.basename(file)}:`, e);
      }
    }
  }
  // ─── QLC+ QXF Format Parser ──────────────────────────────
  // Parses the real QLC+ XML fixture definition format.
  // Structure:
  //   <FixtureDefinition>
  //     <Channel Name="Red" Preset="IntensityRed"/>
  //     <Channel Name="Strobe"><Group>Shutter</Group><Capability Min="0" Max="15">...</Capability></Channel>
  //     <Mode Name="7-Ch"><Channel Number="0">Red</Channel>...</Mode>
  //     <Physical>...</Physical>
  //   </FixtureDefinition>
  /** Map common color names to hex — QXF fixtures rarely have Color attributes on capabilities */
  static COLOR_NAME_MAP = {
    red: "#ff0000",
    green: "#00ff00",
    blue: "#0000ff",
    white: "#ffffff",
    black: "#000000",
    yellow: "#ffff00",
    cyan: "#00ffff",
    magenta: "#ff00ff",
    orange: "#ff8000",
    purple: "#8000ff",
    pink: "#ff80c0",
    amber: "#ffbf00",
    uv: "#8000ff",
    "light blue": "#8080ff",
    "dark blue": "#000080",
    "light green": "#80ff80",
    "dark green": "#008000",
    "light red": "#ff8080",
    "dark red": "#800000",
    salmon: "#fa8072",
    lime: "#00ff00",
    turquoise: "#40e0d0",
    lavender: "#e6e6fa",
    "warm white": "#ffe4b5",
    "cold white": "#f0f8ff",
    "neutral white": "#f5f5dc"
  };
  static extractColorFromName(name) {
    if (!name) return void 0;
    const lower = name.toLowerCase().trim();
    if (_FixtureLibrary.COLOR_NAME_MAP[lower]) return _FixtureLibrary.COLOR_NAME_MAP[lower];
    for (const [key, hex] of Object.entries(_FixtureLibrary.COLOR_NAME_MAP)) {
      if (lower.includes(key)) return hex;
    }
    return void 0;
  }
  async parseQLC(xml, filePath) {
    try {
      const parsed = await (0, import_xml2js2.parseStringPromise)(xml, {
        explicitArray: true,
        mergeAttrs: false
      });
      const fixture = parsed.FixtureDefinition;
      if (!fixture) return null;
      const manufacturer = fixture.Manufacturer?.[0] || "Unknown";
      const model = fixture.Model?.[0] || "Unknown";
      const type = fixture.Type?.[0] || "Other";
      const author = fixture.Creator?.[0]?.Author?.[0] || "Unknown";
      const rootChannels = /* @__PURE__ */ new Map();
      const chList = Array.isArray(fixture.Channel) ? fixture.Channel : [];
      for (const ch of chList) {
        const name = ch.$?.Name || "Unknown";
        let chType = "Nothing";
        const group = ch.Group?.[0]?._;
        if (group) {
          chType = groupToType(group);
        } else if (ch.$?.Preset) {
          chType = presetToType(ch.$?.Preset);
        }
        const capabilities = [];
        const caps = Array.isArray(ch.Capability) ? ch.Capability : ch.Capability ? [ch.Capability] : [];
        for (const cap of caps) {
          capabilities.push({
            min: parseInt(cap.$?.Min || "0"),
            max: parseInt(cap.$?.Max || "255"),
            name: cap._ || cap.$?.Name || `Range ${cap.$?.Min || 0}-${cap.$?.Max || 255}`,
            color: cap.$?.Color || cap.$?.Res1 || _FixtureLibrary.extractColorFromName(cap._ || cap.$?.Name || ""),
            color2: cap.$?.Color2,
            preset: cap.$?.Preset
          });
        }
        rootChannels.set(name.toLowerCase(), {
          name,
          type: chType,
          defaultValue: 0,
          capabilities
        });
      }
      const modes = [];
      const modeList = Array.isArray(fixture.Mode) ? fixture.Mode : fixture.Mode ? [fixture.Mode] : [];
      for (const mode of modeList) {
        const modeName = mode.$?.Name || "Default";
        const channels = [];
        const modeChList = Array.isArray(mode.Channel) ? mode.Channel : mode.Channel ? [mode.Channel] : [];
        for (const mch of modeChList) {
          const refName = (mch._ || mch.$?.Name || "").trim();
          const root = rootChannels.get(refName.toLowerCase());
          if (root) {
            channels.push({
              name: root.name,
              type: root.type,
              defaultValue: root.defaultValue,
              capabilities: root.capabilities.length > 0 ? root.capabilities : void 0
            });
          } else {
            channels.push({
              name: refName || `Channel ${mch.$?.Number || channels.length + 1}`,
              type: "Nothing",
              defaultValue: 0
            });
          }
        }
        let physical;
        const physSource2 = mode.Physical?.[0] || fixture.Physical?.[0];
        if (physSource2) {
          physical = {};
          if (physSource2.Bulb?.[0]) {
            const b = physSource2.Bulb[0].$ || {};
            if (b.Type) physical.bulbType = b.Type;
            if (b.Lumens) physical.bulbLumens = parseFloat(b.Lumens);
            if (b.ColourTemperature) physical.bulbColorTemp = parseFloat(b.ColourTemperature);
          }
          if (physSource2.Dimensions?.[0]) {
            const d = physSource2.Dimensions[0].$ || {};
            if (d.Weight) physical.weight = parseFloat(d.Weight);
            if (d.Width) physical.width = parseFloat(d.Width);
            if (d.Height) physical.height = parseFloat(d.Height);
            if (d.Depth) physical.depth = parseFloat(d.Depth);
          }
          if (physSource2.Lens?.[0]) {
            const l = physSource2.Lens[0].$ || {};
            if (l.Name) physical.lensName = l.Name;
            if (l.DegreesMin) physical.lensDegMin = parseFloat(l.DegreesMin);
            if (l.DegreesMax) physical.lensDegMax = parseFloat(l.DegreesMax);
          }
          if (physSource2.Focus?.[0]) {
            const f = physSource2.Focus[0].$ || {};
            if (f.Type) physical.focusType = f.Type;
            if (f.PanMax) physical.panMax = parseFloat(f.PanMax);
            if (f.TiltMax) physical.tiltMax = parseFloat(f.TiltMax);
          }
          if (physSource2.Technical?.[0]) {
            const t = physSource2.Technical[0].$ || {};
            if (t.PowerConsumption) physical.powerConsumption = parseFloat(t.PowerConsumption);
            if (t.DmxConnector) physical.DMXConnector = t.DmxConnector;
          }
        }
        modes.push({
          name: modeName,
          channels,
          physical
        });
      }
      let globalPhysical;
      const physSource = fixture.Physical?.[0];
      if (physSource) {
        globalPhysical = {};
        if (physSource.Bulb?.[0]) {
          const b = physSource.Bulb[0].$ || {};
          if (b.Type) globalPhysical.bulbType = b.Type;
          if (b.Lumens) globalPhysical.bulbLumens = parseFloat(b.Lumens);
          if (b.ColourTemperature) globalPhysical.bulbColorTemp = parseFloat(b.ColourTemperature);
        }
        if (physSource.Dimensions?.[0]) {
          const d = physSource.Dimensions[0].$ || {};
          if (d.Weight) globalPhysical.weight = parseFloat(d.Weight);
          if (d.Width) globalPhysical.width = parseFloat(d.Width);
          if (d.Height) globalPhysical.height = parseFloat(d.Height);
          if (d.Depth) globalPhysical.depth = parseFloat(d.Depth);
        }
        if (physSource.Lens?.[0]) {
          const l = physSource.Lens[0].$ || {};
          if (l.Name) globalPhysical.lensName = l.Name;
          if (l.DegreesMin) globalPhysical.lensDegMin = parseFloat(l.DegreesMin);
          if (l.DegreesMax) globalPhysical.lensDegMax = parseFloat(l.DegreesMax);
        }
        if (physSource.Focus?.[0]) {
          const f = physSource.Focus[0].$ || {};
          if (f.Type) globalPhysical.focusType = f.Type;
          if (f.PanMax) globalPhysical.panMax = parseFloat(f.PanMax);
          if (f.TiltMax) globalPhysical.tiltMax = parseFloat(f.TiltMax);
        }
        if (physSource.Technical?.[0]) {
          const t = physSource.Technical[0].$ || {};
          if (t.PowerConsumption) globalPhysical.powerConsumption = parseFloat(t.PowerConsumption);
          if (t.DmxConnector) globalPhysical.DMXConnector = t.DmxConnector;
        }
      }
      const heads = [];
      if (fixture.Head) {
        const headList = Array.isArray(fixture.Head) ? fixture.Head : [fixture.Head];
        for (const head of headList) {
          heads.push({
            channels: (head.Channel || []).map((hch) => parseInt(hch) || 0)
          });
        }
      }
      const id = `${manufacturer}-${model}`.replace(/\s+/g, "-").replace(/[^a-zA-Z0-9_-]/g, "");
      return {
        id,
        manufacturer,
        model,
        type,
        author,
        modes,
        heads: heads.length > 0 ? heads : void 0,
        physical: globalPhysical,
        qlcplusFile: filePath ? import_path2.default.basename(filePath) : void 0
      };
    } catch (e) {
      console.warn("Failed to parse QXF:", e);
      return null;
    }
  }
  // ─── OFL Fixture Parser ──────────────────────────────────
  // Parses Open Fixture Library JSON format.
  // Each fixture JSON lives in a manufacturer-key directory.
  // Schema: name, categories, meta, availableChannels, modes
  parseOFLFixture(json, manufacturerKey) {
    try {
      const data = JSON.parse(json);
      if (data.redirectTo) return null;
      const manufacturer = OFL_MANUFACTURER_MAP[manufacturerKey] || manufacturerKey;
      const model = data.name || "Unknown";
      const categories = data.categories || [];
      let type = "Other";
      for (const cat of categories) {
        const c = cat.toLowerCase();
        if (c.includes("laser")) {
          type = "Laser";
          break;
        }
        if (c.includes("color")) type = "Color Changer";
        else if (c.includes("moving head")) type = "Moving Head";
        else if (c.includes("scanner")) type = "Scanner";
        else if (c.includes("dimmer")) type = "Dimmer";
        else if (c.includes("strobe")) type = "Strobe";
        else if (c.includes("hazer") || c.includes("fog") || c.includes("smoke")) type = "Smoke";
        else if (c.includes("fan")) type = "Fan";
        else if (c.includes("flower")) type = "Flower";
        else if (c.includes("effect")) type = "Effect";
      }
      const author = data.meta?.authors && data.meta.authors.length > 0 ? data.meta.authors.join(", ") : "Open Fixture Library";
      const availableChannels = data.availableChannels || {};
      const channelDefs = /* @__PURE__ */ new Map();
      for (const [chName, chData] of Object.entries(availableChannels)) {
        const chAny = chData;
        let chType = "Nothing";
        let firstCapType = "";
        if (chAny.capability) {
          firstCapType = chAny.capability.type || "";
        } else if (chAny.capabilities && Array.isArray(chAny.capabilities) && chAny.capabilities.length > 0) {
          firstCapType = chAny.capabilities[0].type || "";
        }
        if (firstCapType) {
          chType = oflCapTypeToChannelType(firstCapType, chName);
        }
        const capabilities = [];
        const capList = chAny.capabilities ? Array.isArray(chAny.capabilities) ? chAny.capabilities : [chAny.capabilities] : chAny.capability ? [chAny.capability] : [];
        for (const cap of capList) {
          const dmxRange = cap.dmxRange || [0, 255];
          const capName = cap.comment || cap.effectName || cap.type || "";
          const capObj = {
            min: dmxRange[0] ?? 0,
            max: dmxRange[1] ?? 255,
            name: capName
          };
          if (cap.color) {
            capObj.color = cap.color;
          }
          if (cap.colorsStart && Array.isArray(cap.colorsStart) && cap.colorsStart.length > 0) {
            capObj.color = cap.colorsStart[0];
          }
          if (cap.colorsEnd && Array.isArray(cap.colorsEnd) && cap.colorsEnd.length > 0) {
            capObj.color2 = cap.colorsEnd[0];
          }
          capabilities.push(capObj);
        }
        channelDefs.set(chName.toLowerCase(), {
          name: chName,
          type: chType,
          defaultValue: normalizeOflDefault(chAny.defaultValue),
          rawDefault: chAny.defaultValue,
          capabilities
        });
      }
      const fineAliasMap = /* @__PURE__ */ new Map();
      const switchingAliasMap = /* @__PURE__ */ new Map();
      for (const [chName, chData] of Object.entries(availableChannels)) {
        const chAny = chData;
        const parent = channelDefs.get(chName.toLowerCase());
        if (!parent) continue;
        const aliases = Array.isArray(chAny.fineChannelAliases) ? chAny.fineChannelAliases : [];
        for (const alias of aliases) {
          const raw = parent.rawDefault;
          const fineDefault = typeof raw === "number" && raw > 255 ? raw & 255 : 0;
          fineAliasMap.set(alias.toLowerCase(), { ...parent, name: alias, defaultValue: fineDefault, capabilities: [] });
        }
        const switchAliases = Array.isArray(chAny.switchingChannelAliases) ? chAny.switchingChannelAliases : [];
        for (const alias of switchAliases) {
          switchingAliasMap.set(alias.toLowerCase(), { ...parent, name: alias, capabilities: [] });
        }
        if (chAny.switchingChannels && !Array.isArray(chAny.switchingChannelAliases)) {
          console.warn(`OFL switchingChannels sur \xAB ${chName} \xBB : canaux de commutation conserv\xE9s tels quels`);
        }
      }
      const templateChannels = data.templateChannels || {};
      const matrix = data.matrix || {};
      const pixelKeys = [];
      for (const row of matrix.pixelKeys || []) {
        for (const cell of row) {
          for (const px of cell) pixelKeys.push(String(px));
        }
      }
      if (pixelKeys.length === 0 && Array.isArray(matrix.pixelCount)) {
        let total = 1;
        for (const n of matrix.pixelCount) total *= Number(n) || 1;
        for (let i = 1; i <= total; i++) pixelKeys.push(String(i));
      }
      const pixelGroups = {};
      for (const [g, list] of Object.entries(matrix.pixelGroups || {})) {
        if (Array.isArray(list)) {
          pixelGroups[g] = list.map(String);
        } else if (list === "all") {
          pixelGroups[g] = pixelKeys.slice();
        } else {
          pixelGroups[g] = [String(list)];
        }
      }
      const pixelCandidates = [...pixelKeys];
      for (const g of Object.keys(pixelGroups)) {
        if (!pixelCandidates.includes(g)) pixelCandidates.push(g);
      }
      const modeList = data.modes || [];
      for (const mode of modeList) {
        for (const chRef of mode.channels || []) {
          if (typeof chRef !== "string") continue;
          for (const tplName of Object.keys(templateChannels)) {
            if (!tplName.includes("$pixelKey")) continue;
            const rx = new RegExp("^" + tplName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\$pixelKey/g, "(.+)") + "$", "i");
            const m = chRef.match(rx);
            if (m && m[1] && !pixelCandidates.includes(m[1])) pixelCandidates.push(m[1]);
          }
        }
      }
      const resolvedTemplates = /* @__PURE__ */ new Map();
      const buildResolved = (tplName, tplAny, variables) => {
        let resolvedName = tplName;
        for (const [k, v] of Object.entries(variables)) {
          resolvedName = resolvedName.replace(new RegExp("\\$" + k, "g"), v);
        }
        if (!resolvedName.includes("$")) {
          let displayName = resolvedName;
          if (typeof tplAny.name === "string" && tplAny.name.includes("$")) {
            displayName = tplAny.name;
            for (const [k, v] of Object.entries(variables)) {
              displayName = displayName.replace(new RegExp("\\$" + k, "g"), v);
            }
          }
          resolvedTemplates.set(resolvedName.toLowerCase(), {
            name: displayName,
            type: oflCapTypeToChannelType(tplAny.capability?.type || (Array.isArray(tplAny.capabilities) ? tplAny.capabilities[0]?.type : "") || "", tplName),
            defaultValue: normalizeOflDefault(tplAny.defaultValue),
            capabilities: []
          });
        }
      };
      for (const [tplName, tplData] of Object.entries(templateChannels)) {
        const tplAny = tplData;
        if (tplName.includes("$pixelKey")) {
          for (const val of pixelCandidates) buildResolved(tplName, tplAny, { pixelKey: val });
        } else if (tplName.includes("$pixelGroup")) {
          for (const g of Object.keys(pixelGroups)) buildResolved(tplName, tplAny, { pixelGroup: g });
        }
      }
      const modes = [];
      const resolveRef = (chRef) => {
        if (!chRef || !chRef.trim()) return null;
        const key = chRef.toLowerCase();
        const def = channelDefs.get(key) || fineAliasMap.get(key) || switchingAliasMap.get(key) || resolvedTemplates.get(key);
        if (def) {
          return {
            name: def.name,
            type: def.type,
            defaultValue: def.defaultValue,
            capabilities: def.capabilities.length > 0 ? def.capabilities : void 0
          };
        }
        return { name: chRef, type: "Nothing", defaultValue: 0 };
      };
      const resolveRefs = (refs) => {
        const out = [];
        for (const chRef of refs) {
          if (chRef === null || chRef === void 0) continue;
          if (typeof chRef === "string") {
            const ch = resolveRef(chRef);
            if (ch) out.push(ch);
            continue;
          }
          if (typeof chRef === "object") {
            const ins = chRef.insert;
            if (ins === "matrixChannels") {
              const repeatFor = String(chRef.repeatFor || "eachPixelABC");
              const channelOrder = String(chRef.channelOrder || "perPixel");
              const tplList = Array.isArray(chRef.templateChannels) ? chRef.templateChannels : [];
              let order = [];
              if (repeatFor === "eachPixelGroup") {
                order = Object.keys(pixelGroups);
              } else if (repeatFor.includes(",")) {
                order = repeatFor.split(",").map((s) => s.trim()).filter(Boolean);
              } else {
                order = pixelKeys.length > 0 ? pixelKeys : pixelCandidates;
              }
              if (order.length === 0) order = pixelCandidates;
              if (channelOrder === "perChannel") {
                for (const tplName of tplList) {
                  for (const val of order) {
                    const ch = resolveRef(tplName.replace(/\$pixelKey/g, val));
                    if (ch) out.push(ch);
                  }
                }
              } else {
                for (const val of order) {
                  for (const tplName of tplList) {
                    const ch = resolveRef(tplName.replace(/\$pixelKey/g, val));
                    if (ch) out.push(ch);
                  }
                }
              }
            } else {
              out.push({ name: JSON.stringify(chRef), type: "Nothing", defaultValue: 0 });
            }
          }
        }
        return out;
      };
      for (const mode of modeList) {
        const modeName = mode.name || "Default";
        const modeChannels = mode.channels || [];
        modes.push({ name: modeName, channels: resolveRefs(modeChannels) });
      }
      if (modes.length === 0) {
        const allChannels = [];
        for (const [, def] of channelDefs) {
          allChannels.push({
            name: def.name,
            type: def.type,
            defaultValue: def.defaultValue,
            capabilities: def.capabilities.length > 0 ? def.capabilities : void 0
          });
        }
        if (allChannels.length > 0) {
          modes.push({ name: "Default", channels: allChannels });
        }
      }
      let physical;
      if (data.physical) {
        const phys = data.physical;
        physical = {};
        if (phys.dimensions) {
          physical.width = phys.dimensions[0];
          physical.height = phys.dimensions[1];
          physical.depth = phys.dimensions[2];
        }
        if (phys.weight != null) physical.weight = phys.weight;
        if (phys.power != null) physical.powerConsumption = phys.power;
        if (phys.DMXconnector) physical.DMXConnector = phys.DMXconnector;
        if (phys.bulb) {
          if (phys.bulb.type) physical.bulbType = phys.bulb.type;
          if (phys.bulb.lumens != null) physical.bulbLumens = phys.bulb.lumens;
          if (phys.bulb.colorTemperature != null) physical.bulbColorTemp = phys.bulb.colorTemperature;
        }
        if (phys.lens) {
          if (phys.lens.name) physical.lensName = phys.lens.name;
          if (phys.lens.degreesMinMax) {
            physical.lensDegMin = phys.lens.degreesMinMax[0];
            physical.lensDegMax = phys.lens.degreesMinMax[1];
          }
        }
        if (phys.focus) {
          if (phys.focus.type) physical.focusType = phys.focus.type;
          if (phys.focus.panMax != null) physical.panMax = phys.focus.panMax;
          if (phys.focus.tiltMax != null) physical.tiltMax = phys.focus.tiltMax;
        }
      }
      const id = `${manufacturer}-${model}`.replace(/\s+/g, "-").replace(/[^a-zA-Z0-9_-]/g, "");
      return {
        id,
        manufacturer,
        model,
        type,
        author,
        modes,
        physical
      };
    } catch (e) {
      console.warn(`OFL parse failed (${manufacturerKey}):`, e.message);
      return null;
    }
  }
  // ─── Load OFL directory ─────────────────────────────────
  async loadOflDirectory(dir, options) {
    let added = 0;
    let skipped = 0;
    let updated = 0;
    const overwrite = options?.overwrite ?? false;
    if (!import_fs2.default.existsSync(dir)) {
      console.log("OFL directory not found:", dir);
      return { added, skipped, updated };
    }
    const mfrDirs = import_fs2.default.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory());
    for (const mfrDir of mfrDirs) {
      const mfrPath = import_path2.default.join(dir, mfrDir.name);
      const files = import_fs2.default.readdirSync(mfrPath, { withFileTypes: true }).filter((e) => e.isFile() && e.name.endsWith(".json"));
      for (const file of files) {
        try {
          const content = import_fs2.default.readFileSync(import_path2.default.join(mfrPath, file.name), "utf-8");
          const def = this.parseOFLFixture(content, mfrDir.name);
          if (!def) continue;
          if (this.hasFixture(def.manufacturer, def.model)) {
            if (overwrite) {
              this.fixtures.delete(def.id);
              this.searchIndex = this.searchIndex.filter((s) => s.id !== def.id);
              this.add(def);
              updated++;
            } else {
              skipped++;
            }
            continue;
          }
          this.add(def);
          added++;
        } catch (e) {
          console.warn(`Failed to load OFL fixture ${mfrDir.name}/${file.name}:`, e);
        }
      }
    }
    console.log(`OFL import from ${import_path2.default.basename(dir)}: ${added} added, ${updated} updated, ${skipped} skipped`);
    return { added, skipped, updated };
  }
  // ─── Load GDTF directory ─────────────────────────────────
  async loadGdtfDirectory(dir) {
    let added = 0;
    let skipped = 0;
    if (!import_fs2.default.existsSync(dir)) {
      console.log("GDTF directory not found:", dir);
      return { added, skipped };
    }
    const files = getAllFiles(dir, ".gdtf");
    for (const file of files) {
      try {
        const def = await parseGdtfFile(file);
        if (!def) {
          console.warn(`GDTF ignor\xE9 (description.xml introuvable ou invalide) : ${import_path2.default.basename(file)}`);
          continue;
        }
        if (this.hasFixture(def.manufacturer, def.model)) {
          skipped++;
          continue;
        }
        this.add(def);
        added++;
      } catch (e) {
        console.warn(`Failed to load GDTF fixture ${import_path2.default.basename(file)}:`, e);
      }
    }
    console.log(`GDTF import from ${import_path2.default.basename(dir)}: ${added} added, ${skipped} skipped`);
    return { added, skipped };
  }
  // ─── Import QLC+ fixture definitions ─────────────────────
  async importQLC(filePath) {
    const content = import_fs2.default.readFileSync(filePath, "utf-8");
    const def = await this.parseQLC(content, filePath);
    if (def) {
      this.add(def);
      const userDir = import_path2.default.join(import_electron.app.getPath("userData"), "fixtures");
      import_fs2.default.mkdirSync(userDir, { recursive: true });
      import_fs2.default.writeFileSync(import_path2.default.join(userDir, `${def.id}.json`), JSON.stringify(def, null, 2));
    }
    return def;
  }
  // ─── Import GDTF fixture definition ──────────────────────
  async importGDTF(filePath) {
    const def = await parseGdtfFile(filePath);
    if (def) {
      this.add(def);
      const userDir = import_path2.default.join(import_electron.app.getPath("userData"), "fixtures");
      import_fs2.default.mkdirSync(userDir, { recursive: true });
      import_fs2.default.writeFileSync(import_path2.default.join(userDir, `${def.id}.json`), JSON.stringify(def, null, 2));
    }
    return def;
  }
  // ─── Normalized dedup key ───────────────────────────────
  normalizeKey(manufacturer, model) {
    return `${manufacturer}-${model}`.toLowerCase().replace(/[^a-z0-9]/g, "-");
  }
  /** Normalise un id de fixture : retire le préfixe « custom- » et met en minuscules.
   *  Permet de résoudre un fixtureDefId GDTF original (ex. "stage-right-Stage-Wash-7x10W-LED-Moving-Head")
   *  vers la def ré-écrite par addCustom (ex. "custom-stage-right-stage-wash-7x10w-led-moving-head"). */
  normalizeId(id) {
    return id.replace(/^custom-/i, "").toLowerCase();
  }
  hasFixture(manufacturer, model) {
    return this.normalizedKeys.has(this.normalizeKey(manufacturer, model));
  }
  // ─── CRUD ────────────────────────────────────────────────
  add(def) {
    const isNew = !this.fixtures.has(def.id);
    this.fixtures.set(def.id, def);
    this.normalizedKeys.add(this.normalizeKey(def.manufacturer, def.model));
    this.normalizedIdMap.set(this.normalizeId(def.id), def.id);
    if (isNew) {
      this.searchIndex.push({
        id: def.id,
        manufacturer: def.manufacturer || "Unknown",
        model: def.model || "Unknown",
        type: def.type || "Other"
      });
    }
  }
  addCustom(def) {
    if (!def.id) {
      def.id = `custom-${def.manufacturer}-${def.model}`.replace(/\s+/g, "-").toLowerCase();
    }
    this.add(def);
    const userDir = import_path2.default.join(import_electron.app.getPath("userData"), "fixtures");
    import_fs2.default.mkdirSync(userDir, { recursive: true });
    import_fs2.default.writeFileSync(import_path2.default.join(userDir, `${def.id}.json`), JSON.stringify(def, null, 2));
  }
  get(id) {
    const exact = this.fixtures.get(id);
    if (exact) return exact;
    const actualId = this.normalizedIdMap.get(this.normalizeId(id));
    return actualId ? this.fixtures.get(actualId) : void 0;
  }
  search(query) {
    const q = query.toLowerCase();
    const results = this.searchIndex.filter(
      (f) => (f.manufacturer || "").toLowerCase().includes(q) || (f.model || "").toLowerCase().includes(q) || (f.type || "").toLowerCase().includes(q)
    ).map((f) => this.fixtures.get(f.id)).filter(Boolean);
    return results;
  }
  getAll() {
    return Array.from(this.fixtures.values());
  }
  getByType(type) {
    return this.getAll().filter((f) => f.type === type);
  }
  getByManufacturer(manufacturer) {
    const m = manufacturer.toLowerCase();
    return this.getAll().filter((f) => f.manufacturer.toLowerCase() === m);
  }
  getStats() {
    const byType = {};
    const byManufacturer = {};
    for (const [, def] of this.fixtures) {
      byType[def.type] = (byType[def.type] || 0) + 1;
      byManufacturer[def.manufacturer] = (byManufacturer[def.manufacturer] || 0) + 1;
    }
    return { total: this.fixtures.size, byType, byManufacturer };
  }
  // ─── Bibliothèque « Budget < 100 € » ──────────────────────
  // Fichier racine de ofl/ (ignoré par loadOflDirectory qui n'itère que les
  // sous-dossiers fabricants). NE PAS le déplacer dans resources/fixtures/
  // (serait parsé comme fixture par loadDirectory).
  budgetCache = null;
  getBudgetList() {
    if (this.budgetCache) return this.budgetCache;
    const p = import_path2.default.join(resolveBundledFixturesRoot(), "ofl", "budget.json");
    if (import_fs2.default.existsSync(p)) {
      try {
        this.budgetCache = JSON.parse(import_fs2.default.readFileSync(p, "utf-8"));
        if (Array.isArray(this.budgetCache?.entries)) return this.budgetCache;
        this.budgetCache = null;
      } catch {
        this.budgetCache = null;
      }
    }
    return { entries: [] };
  }
  // ─── Fixture Instance Creator ────────────────────────────
  createInstance(defId, modeIndex = 0, startAddress = 1) {
    const def = this.get(defId);
    if (!def || modeIndex >= def.modes.length) return null;
    const mode = def.modes[modeIndex];
    return new FixtureInstance(def, modeIndex, startAddress);
  }
};
var FixtureInstance = class {
  id;
  definition;
  modeIndex;
  mode;
  startAddress;
  name;
  constructor(def, modeIndex, startAddress) {
    this.id = `fixture-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.definition = def;
    this.modeIndex = modeIndex;
    this.mode = def.modes[modeIndex];
    this.startAddress = startAddress;
    this.name = `${def.manufacturer} ${def.model}`;
  }
  get channelCount() {
    return this.mode.channels.length;
  }
  get endAddress() {
    return this.startAddress + this.channelCount - 1;
  }
  getChannelOffset(channelName) {
    const idx = this.mode.channels.findIndex(
      (ch) => ch.name.toLowerCase() === channelName.toLowerCase()
    );
    return idx >= 0 ? idx : null;
  }
  // Get the DMX channel map for this fixture
  getChannelMap() {
    const map = {};
    this.mode.channels.forEach((ch, i) => {
      map[ch.name] = this.startAddress + i;
      map[ch.type] = this.startAddress + i;
    });
    return map;
  }
  // Convenience setters for common channel types
  setIntensity(value) {
    for (let i = 0; i < this.mode.channels.length; i++) {
      if (this.mode.channels[i].type === "Intensity") {
        return { [this.startAddress + i]: value };
      }
    }
    return {};
  }
  setPanTilt(pan, tilt) {
    const map = {};
    for (let i = 0; i < this.mode.channels.length; i++) {
      if (this.mode.channels[i].type === "Pan") map[this.startAddress + i] = pan;
      if (this.mode.channels[i].type === "Tilt") map[this.startAddress + i] = tilt;
    }
    return map;
  }
  setRGB(r, g, b) {
    const map = {};
    let colorIdx = 0;
    for (let i = 0; i < this.mode.channels.length; i++) {
      if (this.mode.channels[i].type === "Colour") {
        const colors = [r, g, b];
        if (colorIdx < 3) map[this.startAddress + i] = colors[colorIdx++];
      }
    }
    return map;
  }
};

// .cluster/coverage-generic/audit.ts
init_fixture_analyzer();
globalThis.localStorage = {
  getItem: () => null,
  setItem: () => {
  },
  removeItem: () => {
  },
  clear: () => {
  },
  key: () => null,
  length: 0
};
var ROOT = path3.resolve(__dirname, "..", "..");
var OFL_DIR = path3.join(ROOT, "resources", "fixtures", "ofl");
function laserReason(defType, channels) {
  const norm = String(defType ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (norm.includes("laser")) return "type";
  const laserSig = channels.some(
    (c) => /laser/i.test(c.name ?? "") || (c.capabilities ?? []).some((cap) => /laser/i.test(cap.name ?? ""))
  );
  if (laserSig) return "signature";
  const names = channels.map((c) => (c.name ?? "").toLowerCase());
  const hasPattern = names.some((n) => /\bpattern\b/.test(n));
  const hasScanAxis = names.some(
    (n) => /(horizontal|vertical)\s*(angle|movement|position)/.test(n) || /\bscan/.test(n) || /\bcircular/.test(n)
  );
  const hasColor = channels.some(
    (c) => /\bcolor|colour\b/i.test(c.name ?? "") && (c.type === "Colour" || (c.capabilities ?? []).some((cap) => cap.color))
  );
  if (hasPattern && hasScanAxis && hasColor) return "fallback";
  return "none";
}
function chanInfo(ch, i) {
  const caps = ch.capabilities ?? [];
  return {
    offset: ch.offset ?? i,
    name: ch.name ?? "",
    type: ch.type,
    caps: caps.length,
    firstCap: caps[0]?.name ? `${caps[0].name} ${caps[0].min}-${caps[0].max}` : void 0,
    capRanges: caps.length > 1 ? caps.slice(0, 4).map((c) => `${c.name} ${c.min}-${c.max}`).join(" | ") : void 0
  };
}
function rolesExploitables(fa) {
  const r = [];
  if (fa.laserModeOffset !== null) r.push(`mode@${fa.laserModeOffset}`);
  if (fa.patternOffset !== null) r.push(`pattern@${fa.patternOffset} (${fa.patternCaps.length} caps)`);
  if (fa.scanXOffset !== null) r.push(`scanX@${fa.scanXOffset}`);
  if (fa.scanYOffset !== null) r.push(`scanY@${fa.scanYOffset}`);
  if (fa.rgbOffsets !== null && fa.rgbOffsets.length >= 2) r.push(`rgb[${fa.rgbOffsets.join(",")}]`);
  if (fa.wheelOffset !== null && fa.wheelCaps.length > 0) r.push(`wheel@${fa.wheelOffset} (${fa.wheelCaps.length} caps)`);
  if (fa.laserRotationOffsets.length > 0) r.push(`rot[${fa.laserRotationOffsets.join(",")}]`);
  if (fa.laserColorGateOffset !== null && fa.laserColorGateCaps?.length > 0) r.push(`gate@${fa.laserColorGateOffset}`);
  return r;
}
function rolesManquants(fa, channels) {
  const m = [];
  const ch = (off) => off === null ? "-" : `${off}`;
  m.push(`mode=${ch(fa.laserModeOffset)}`);
  m.push(`pattern=${ch(fa.patternOffset)}`);
  m.push(`scanX=${ch(fa.scanXOffset)}`);
  m.push(`scanY=${ch(fa.scanYOffset)}`);
  m.push(`rgb=${fa.rgbOffsets ? `[${fa.rgbOffsets.join(",")}]` : "-"}`);
  m.push(`wheel=${ch(fa.wheelOffset)}${fa.wheelOffset !== null && fa.wheelCaps.length === 0 ? "(0 cap!)" : ""}`);
  m.push(`rot=[${fa.laserRotationOffsets.join(",")}]`);
  m.push(`blank=${ch(fa.blankOffset)}`);
  return m;
}
async function main() {
  const out = {
    generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    oflDir: OFL_DIR,
    stats: {},
    i1Failures: [],
    lasersMuets: [],
    tousLasers: [],
    fauxPositifs: [],
    projecteursExclus: [],
    i2Violations: []
  };
  const lib = new FixtureLibrary();
  const loadResult = await lib.loadOflDirectory(OFL_DIR);
  console.log(`[audit] loadOflDirectory \u2192 ${JSON.stringify(loadResult)}`);
  const files = [];
  const byId = /* @__PURE__ */ new Map();
  const mfrDirs = fs3.readdirSync(OFL_DIR, { withFileTypes: true }).filter((e) => e.isDirectory());
  for (const mfrDir of mfrDirs) {
    const mfrPath = path3.join(OFL_DIR, mfrDir.name);
    const jsonFiles = fs3.readdirSync(mfrPath, { withFileTypes: true }).filter((e) => e.isFile() && e.name.endsWith(".json"));
    for (const f of jsonFiles) {
      const rel = path3.join(mfrDir.name, f.name);
      const full = path3.join(mfrPath, f.name);
      let entry;
      try {
        const content = fs3.readFileSync(full, "utf-8");
        const def = lib.parseOFLFixture(content, mfrDir.name);
        if (def) {
          entry = { file: rel, def, err: null, dupOf: byId.has(def.id) ? byId.get(def.id).file : null };
          if (!byId.has(def.id)) byId.set(def.id, entry);
        } else {
          entry = { file: rel, def: null, err: "parseOFLFixture \u2192 null (redirect ou invalide)", dupOf: null };
        }
      } catch (e) {
        entry = { file: rel, def: null, err: e.message, dupOf: null };
      }
      files.push(entry);
    }
  }
  const parseFailed = files.filter((f) => f.def === null);
  const dups = files.filter((f) => f.dupOf);
  const defs = lib.getAll();
  console.log(`[audit] fichiers JSON=${files.length} defs=${defs.length} parseFails=${parseFailed.length} doublons=${dups.length}`);
  function longestMode(def) {
    let best = -1;
    let bestLen = -1;
    (def.modes ?? []).forEach((m, i) => {
      const l = (m.channels ?? []).length;
      if (l > bestLen) {
        bestLen = l;
        best = i;
      }
    });
    if (best < 0) return { channels: [], index: 0, name: "Default" };
    return { channels: def.modes[best].channels, index: best, name: def.modes[best].name };
  }
  let nLasers = 0;
  let nMuets = 0;
  let nFauxPos = 0;
  let sumCanauxMorts = 0;
  let nI2Fail = 0;
  defs.forEach((rawDef, i) => {
    const def = rawDef;
    const mode = longestMode(def);
    const channels = mode.channels;
    const fileEntry = byId.get(def.id);
    const file = fileEntry?.file ?? "?";
    const pf = {
      id: def.id,
      fixtureDefId: def.id,
      manufacturer: def.manufacturer,
      model: def.model,
      fixtureType: def.type,
      modeIndex: mode.index,
      modeName: mode.name,
      universeId: "U1",
      startAddress: 1 + i * 15 % 480,
      channelCount: channels.length,
      name: `${def.manufacturer} ${def.model}`,
      tier: "primary"
    };
    let fa;
    try {
      fa = analyzeFixtureChannels(pf, def);
    } catch (e) {
      out.i1Failures.push({
        file,
        manufacturer: def.manufacturer,
        model: def.model,
        fixtureType: def.type,
        mode: mode.name,
        error: e.message
      });
      return;
    }
    if (!fa.isLaser) {
      if (String(def.type).toLowerCase().includes("laser")) {
        out.projecteursExclus.push({
          file,
          manufacturer: def.manufacturer,
          model: def.model,
          fixtureType: def.type,
          mode: mode.name,
          channelCount: channels.length
        });
      }
      return;
    }
    nLasers++;
    const reason = laserReason(def.type, channels);
    const exploitable = rolesExploitables(fa);
    out.tousLasers.push({
      file,
      manufacturer: def.manufacturer,
      model: def.model,
      fixtureType: def.type,
      mode: mode.name,
      channelCount: channels.length,
      reason,
      roles: exploitable,
      laserColorMode: fa.laserColorMode,
      muet: exploitable.length === 0
    });
    if (exploitable.length === 0) {
      nMuets++;
      sumCanauxMorts += channels.length;
      const presque = [];
      if (fa.wheelOffset !== null && fa.wheelCaps.length === 0) presque.push("wheelOffset set mais 0 capability -> le bloc roue n'ecrit rien");
      if (fa.rgbOffsets !== null && fa.rgbOffsets.length < 2) presque.push(`rgbOffsets=[${fa.rgbOffsets.join(",")}] mais <2 canaux \u2192 bloc gates inactif`);
      if (fa.patternOffset !== null && fa.patternCaps.length === 0) presque.push("pattern sans caps ni synth\xE8se");
      out.lasersMuets.push({
        file,
        manufacturer: def.manufacturer,
        model: def.model,
        fixtureType: def.type,
        mode: mode.name,
        channelCount: channels.length,
        reason,
        exploitable,
        manquants: rolesManquants(fa, channels),
        presque,
        canaux: channels.map((c, ci) => chanInfo(c, ci))
      });
    }
    if (reason === "fallback") {
      nFauxPos++;
      out.fauxPositifs.push({
        file,
        manufacturer: def.manufacturer,
        model: def.model,
        fixtureType: def.type,
        mode: mode.name,
        channelCount: channels.length,
        kind: "fallback-sans-indice",
        canaux: channels.map((c, ci) => chanInfo(c, ci))
      });
    }
  });
  const { computeLaserChannels: computeLaserChannels2 } = await Promise.resolve().then(() => (init_dmx_playback(), dmx_playback_exports));
  const ts = [0, 0.5, 1, 2, 4];
  const energies = [0.1, 0.5, 0.95];
  const palettes = [void 0, "#ff0000", "#00ff00", "#0000ff", "#ff00ff"];
  const faults = /* @__PURE__ */ new Map();
  defs.forEach((rawDef, i) => {
    const def = rawDef;
    const mode = longestMode(def);
    const pf = {
      id: def.id,
      fixtureDefId: def.id,
      manufacturer: def.manufacturer,
      model: def.model,
      fixtureType: def.type,
      modeIndex: mode.index,
      modeName: mode.name,
      universeId: "U1",
      startAddress: 1 + i * 15 % 480,
      channelCount: mode.channels.length,
      name: `${def.manufacturer} ${def.model}`,
      tier: "primary"
    };
    let fa;
    try {
      fa = analyzeFixtureChannels(pf, def);
    } catch {
      return;
    }
    if (!fa.isLaser) return;
    const fileEntry2 = byId.get(def.id);
    const file2 = fileEntry2?.file ?? "?";
    let localFail = false;
    for (const t of ts) {
      for (const energy of energies) {
        for (const palette of palettes) {
          const chVals = {};
          computeLaserChannels2(fa, pf, chVals, t, energy, palette);
          for (const [addrS, v] of Object.entries(chVals)) {
            const addr = Number(addrS);
            if (!Number.isInteger(v) || v < 0 || v > 255 || Number.isNaN(v)) {
              localFail = true;
              out.i2Violations.push({
                file: file2,
                manufacturer: def.manufacturer,
                model: def.model,
                fixtureType: def.type,
                t,
                energy,
                palette: palette ?? "(defaut)",
                addr,
                value: v
              });
            }
          }
        }
      }
    }
    if (localFail) {
      nI2Fail++;
      faults.set(def.id, []);
    }
  });
  const gravite = (m) => 1e3 + m.channelCount;
  out.lasersMuets.sort((a, b) => gravite(b) - gravite(a));
  out.fauxPositifs.sort((a, b) => b.channelCount - a.channelCount);
  out.i2Violations.sort((a, b) => b.addr - a.addr);
  out.i1Failures.sort((a, b) => a.file.localeCompare(b.file));
  out.stats = {
    fichiersJson: files.length,
    defsChargees: defs.length,
    redirects: parseFailed.length,
    parseFailFiles: parseFailed.map((f) => f.file),
    doublons: dups.map((f) => f.file),
    lasers: nLasers,
    lasersMuets: nMuets,
    canauxLasersNonExploites: sumCanauxMorts,
    fauxPositifs: nFauxPos,
    projecteursExclus: out.projecteursExclus.length,
    i1Failures: out.i1Failures.length,
    i2FixturesFails: nI2Fail,
    i2Violations: out.i2Violations.length
  };
  fs3.writeFileSync(path3.join(__dirname, "out.json"), JSON.stringify(out, null, 2), "utf-8");
  console.log("\u2550\u2550\u2550\u2550\u2550\u2550 R\xC9SUM\xC9 AUDIT COUVERTURE G\xC9N\xC9RIQUE \u2550\u2550\u2550\u2550\u2550\u2550");
  console.log(`fixtures OFL : ${defs.length} (${files.length} fichiers JSON, ${parseFailed.length} redirects OFL ignor\xE9s, ${dups.length} doublons)`);
  console.log(`I1 (analyse qui throw) : ${out.i1Failures.length}`);
  console.log(`lasers (isLaser) : ${nLasers} | muets (I3) : ${nMuets} | canaux non exploit\xE9s : ${sumCanauxMorts}`);
  console.log(`faux positifs (I4, fallback seul) : ${nFauxPos} | exclusions projecteur (garde isVideoProjector) : ${out.projecteursExclus.length}`);
  console.log(`I2 (valeurs hors [0,255]) : ${nI2Fail} fixtures, ${out.i2Violations.length} violations`);
  console.log("\u2500\u2500 lasers muets (tous) \u2500\u2500");
  for (const m of out.lasersMuets) console.log(`  ${m.file} (${m.channelCount}ch, raison=${m.reason})`);
  console.log("\u2500\u2500 faux positifs (tous) \u2500\u2500");
  for (const f of out.fauxPositifs) console.log(`  ${f.file} (${f.channelCount}ch, ${f.kind})`);
  console.log("\u2500\u2500 exclusions projecteur \u2500\u2500");
  for (const p of out.projecteursExclus) console.log(`  ${p.file} (${p.channelCount}ch)`);
  console.log("\u2500\u2500 violations I2 (fixtures) \u2500\u2500");
  const i2ByFile = /* @__PURE__ */ new Map();
  for (const v of out.i2Violations) i2ByFile.set(v.file, (i2ByFile.get(v.file) ?? 0) + 1);
  for (const [k, c] of [...i2ByFile.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${k} \xD7 ${c}`);
  console.log("\u2550\u2550\u2550 FIN \u2550\u2550\u2550");
}
main().catch((e) => {
  console.error("[audit] FATAL:", e);
  process.exit(1);
});
/*! Bundled license information:

react/cjs/react.production.min.js:
  (**
   * @license React
   * react.production.min.js
   *
   * Copyright (c) Facebook, Inc. and its affiliates.
   *
   * This source code is licensed under the MIT license found in the
   * LICENSE file in the root directory of this source tree.
   *)

react/cjs/react.development.js:
  (**
   * @license React
   * react.development.js
   *
   * Copyright (c) Facebook, Inc. and its affiliates.
   *
   * This source code is licensed under the MIT license found in the
   * LICENSE file in the root directory of this source tree.
   *)

use-sync-external-store/cjs/use-sync-external-store-shim.production.js:
  (**
   * @license React
   * use-sync-external-store-shim.production.js
   *
   * Copyright (c) Meta Platforms, Inc. and affiliates.
   *
   * This source code is licensed under the MIT license found in the
   * LICENSE file in the root directory of this source tree.
   *)

use-sync-external-store/cjs/use-sync-external-store-shim.development.js:
  (**
   * @license React
   * use-sync-external-store-shim.development.js
   *
   * Copyright (c) Meta Platforms, Inc. and affiliates.
   *
   * This source code is licensed under the MIT license found in the
   * LICENSE file in the root directory of this source tree.
   *)

use-sync-external-store/cjs/use-sync-external-store-shim/with-selector.production.js:
  (**
   * @license React
   * use-sync-external-store-shim/with-selector.production.js
   *
   * Copyright (c) Meta Platforms, Inc. and affiliates.
   *
   * This source code is licensed under the MIT license found in the
   * LICENSE file in the root directory of this source tree.
   *)

use-sync-external-store/cjs/use-sync-external-store-shim/with-selector.development.js:
  (**
   * @license React
   * use-sync-external-store-shim/with-selector.development.js
   *
   * Copyright (c) Meta Platforms, Inc. and affiliates.
   *
   * This source code is licensed under the MIT license found in the
   * LICENSE file in the root directory of this source tree.
   *)
*/
