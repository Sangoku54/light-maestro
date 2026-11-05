# Subagent 44 — classifySections 'unknown' Analysis & Fix

**Date:** 2026-08-15
**File:** `src/hooks/audio-analysis.ts`, function `classifySections` (~line 623–755)

## Problem

The autoscript/QuickShow finds sections classified as `'unknown'`. This happens when a segment falls through every classification condition and hits the final `result[i].type = 'unknown'` at line ~734.

## 1. All conditions leading to `'unknown'`

The classification loop (per segment `i`) tests conditions in this order:

| # | Condition | Result type | Line |
|---|-----------|-------------|------|
| 1 | `midPos < 0.12` | `intro` | ~685 |
| 2 | `midPos > 0.92` | `outro` | ~689 |
| 3 | `isRepeated && isHighestEnergy && classEnergy > 0.45 && numDistinctClasses > 1 && energyRatio > 1.1` | `chorus` | ~697 |
| 4 | `i > 0 && seg.energy > 0.55 && (seg.energy > prevSeg.energy * 1.4 \|\| seg.energy > 0.65)` | `drop` | ~702 |
| 5 | `betweenChoruses && seg.energy < classEnergy * 0.85` | `bridge` | ~712 |
| 6 | `isRepeated && !isHighestEnergy` | `verse` | ~717 |
| 7 | `!isRepeated && seg.energy < 0.4` | `bridge` | ~721 |
| 8 | `isRepeated` (catch-all for repeated, i.e. `isRepeated && isHighestEnergy` that failed condition #3) | `verse` | ~725 |
| 9 | **none of the above** | **`unknown`** | ~734 |

### The only path to `unknown`

A segment reaches `'unknown'` when ALL of these are true simultaneously:

1. `midPos >= 0.12 && midPos <= 0.92` (not intro/outro)
2. NOT (isRepeated && isHighestEnergy && classEnergy > 0.45 && numDistinctClasses > 1 && energyRatio > 1.1) — failed chorus
3. NOT (energy > 0.55 && (energy spike or energy > 0.65)) — failed drop
4. NOT betweenChoruses with lower energy — failed bridge
5. **`!isRepeated`** — not repeated (so conditions #6 and #8 don't apply)
6. **`seg.energy >= 0.4`** — energy too high for the low-energy bridge fallback (condition #7)

**Summary:** `unknown` = a **non-repeated, mid-to-high energy segment** that isn't the highest-energy class, isn't a dramatic energy spike, and isn't sandwiched between choruses.

## 2. Cases where a section stays 'unknown' but should be classified

### Case A: Solo non-repeated high-energy section (hook/solo)
A segment with `energy = 0.50`, `isRepeated = false`, `midPos = 0.5`. It's not a drop (no 1.4× spike), not low enough for bridge (≥ 0.4), not repeated. This is likely a **hook**, **solo**, or **instrumental break** — but there's no classification for it.

### Case B: Non-repeated segment with moderate energy in a song with only 1 distinct class
When `numDistinctClasses === 1`, the chorus condition (#3) requires `> 1`. Every segment has the same label, so `isRepeated = true` for all, and they'd hit condition #8 (`verse`). But if structural labeling failed and produced all unique labels, every segment is `!isRepeated`, and moderate-energy ones fall to `unknown`.

### Case C: The highest-energy class that fails the chorus threshold
If `isRepeated = true`, `isHighestEnergy = true`, but `classEnergy ≤ 0.45` or `energyRatio ≤ 1.1` or `numDistinctClasses === 1` — the chorus check fails. The segment then hits condition #8 (`isRepeated` catch-all → `verse`). This is actually handled, but it mislabels what should be a chorus as a verse.

### Case D: Non-repeated segment with energy ≥ 0.4 that sits between two verses
A segment that is unique (`!isRepeated`), has moderate energy (0.4–0.55), and sits between two verses. This is textbook **bridge** material, but the current code only classifies bridges that are explicitly between choruses or have very low energy.

### Case E: Pre-chorus / build
A non-repeated segment with rising energy before a chorus. The type system has `'build'` but `classifySections` never assigns it.

## 3. Proposed Fix

### Strategy: Intelligent fallback before `unknown`

Replace the bare `result[i].type = 'unknown'` with a cascading fallback:

1. **Pre-chorus / build detection**: If the next segment is a chorus and this segment's energy is rising relative to the previous, classify as `build`.
2. **Bridge for non-repeated mid-energy segments**: Relax the energy threshold for non-repeated segments from `< 0.4` to `< 0.55` — any non-repeated segment that isn't a drop or build is likely a bridge.
3. **Final fallback: verse** for anything still unclassified (better than `unknown` — QuickShow can handle verses).

### Patch

**oldText:**
```typescript
    if (!isRepeated && seg.energy < 0.4) {
      result[i].type = 'bridge';
      continue;
    }

    if (isRepeated) {
      result[i].type = 'verse';
      continue;
    }

    result[i].type = 'unknown';
  }
```

**newText:**
```typescript
    if (!isRepeated && seg.energy < 0.4) {
      result[i].type = 'bridge';
      continue;
    }

    // Build / pre-chorus: non-repeated segment with rising energy before a chorus
    if (!isRepeated && i < N - 1) {
      const nextSeg = segments[i + 1];
      const nextIsChorusCandidate = (labelCounts.get(structuralLabels[i + 1]) || 0) > 1
        && structuralLabels[i + 1] === highestEnergyClass;
      const energyRising = i > 0 && seg.energy > segments[i - 1].energy;
      if (nextIsChorusCandidate && (energyRising || seg.energy >= 0.35)) {
        result[i].type = 'build';
        continue;
      }
    }

    // Non-repeated moderate-energy segment between verses → bridge
    if (!isRepeated && seg.energy < 0.55) {
      result[i].type = 'bridge';
      continue;
    }

    if (isRepeated) {
      result[i].type = 'verse';
      continue;
    }

    // Final fallback: never leave 'unknown' — verse is the safest default
    // for a non-repeated, mid-to-high energy segment we couldn't classify.
    result[i].type = 'verse';
  }
```

### Post-loop cleanup addition

Also add a post-loop pass to convert isolated `unknown` sections (in case any remain from edge cases in the merge logic downstream) to `verse`:

**oldText:**
```typescript
  for (let i = 0; i < N; i++) {
    if (result[i].type !== 'chorus') continue;
    const prevRepeated = i > 0 && structuralLabels[i - 1] === structuralLabels[i];
    const nextRepeated = i < N - 1 && structuralLabels[i + 1] === structuralLabels[i];
    if (!prevRepeated && !nextRepeated && i > 0 && i < N - 1) {
      result[i].type = 'verse';
    }
  }

  return result;
```

**newText:**
```typescript
  for (let i = 0; i < N; i++) {
    if (result[i].type !== 'chorus') continue;
    const prevRepeated = i > 0 && structuralLabels[i - 1] === structuralLabels[i];
    const nextRepeated = i < N - 1 && structuralLabels[i + 1] === structuralLabels[i];
    if (!prevRepeated && !nextRepeated && i > 0 && i < N - 1) {
      result[i].type = 'verse';
    }
  }

  // Safety net: eliminate any remaining 'unknown' by contextual inference
  for (let i = 0; i < N; i++) {
    if (result[i].type !== 'unknown') continue;
    const prevType = i > 0 ? result[i - 1].type : null;
    const nextType = i < N - 1 ? result[i + 1].type : null;
    if (prevType === 'chorus' || nextType === 'chorus') {
      result[i].type = 'bridge';
    } else if (prevType === 'verse' || nextType === 'verse') {
      result[i].type = 'verse';
    } else {
      result[i].type = 'verse';
    }
  }

  return result;
```

## Impact Analysis

| Change | Risk | Benefit |
|--------|------|---------|
| `build` detection | Low — new type assignment, no existing condition changed | Adds meaningful pre-chorus classification for QuickShow |
| Bridge threshold 0.4 → 0.55 | Low — only affects non-repeated segments that were previously `unknown` | Fewer unknowns, better bridge detection |
| Final fallback `verse` instead of `unknown` | Very low — verse is the most neutral section type | **Eliminates all `unknown` from classifySections** |
| Post-loop safety net | Zero risk — only touches segments still labeled `unknown` | Catches any edge case missed by the main loop |

The `'build'` type is already in the `TrackSection` type union (line 44) but was never assigned by `classifySections`. This fix activates it.

## Root Cause Summary

The `unknown` fallback existed as a defensive default, but the classification logic had no fallback chain for non-repeated segments with moderate energy (0.4–0.55). The fix adds:
1. A `build` detection step (pre-chorus rising energy)
2. A relaxed bridge threshold for non-repeated segments
3. A `verse` fallback instead of `unknown`
4. A post-loop safety net

This should eliminate all `unknown` sections in QuickShow output.
