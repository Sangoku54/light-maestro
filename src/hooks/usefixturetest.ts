/**
 * useFixtureTest — GrandMA3-style sequential fixture test.
 *
 * When a fixture is patched, the operator can run a test to verify:
 *  1. DMX addressing is correct (fixture responds)
 *  2. All attributes work (pan/tilt/color/strobe/dimmer)
 *
 * Uses standard industry sequence: Dimmer → Pan → Tilt → Colour → Strobe → Reset.
 * DMX values are written through the output arbiter (fixture-test LTP source).
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { dmxBridge } from '../utils/dmx-bridge';

// ─── Types ──────────────────────────────────────────────────

/** Raw fixture definition channel (matches QLC+ channel type names) */
interface FixtureChannelRaw {
  name: string;
  type: string; // 'Intensity' | 'Pan' | 'Tilt' | 'Colour' | 'Gobo' | 'Shutter' | ...
  offset?: number;
  defaultValue?: number;
}

type TestStep = 'dimmer' | 'pan' | 'tilt' | 'colour' | 'strobe' | 'reset' | 'idle';

interface TestState {
  isRunning: boolean;
  currentStep: TestStep;
  stepLabel: string;
  progress: number; // 0..1 for the current step
  elapsed: number;  // total elapsed ms
}

interface TestFixtureParams {
  universeIndex: number;
  startAddress: number;
  channels: FixtureChannelRaw[];
}

// ─── Step definitions ───────────────────────────────────────

const STEP_SEQUENCE: Array<{ step: TestStep; label: string; durationMs: number }> = [
  { step: 'dimmer', label: 'Dimmer', durationMs: 2000 },
  { step: 'pan',    label: 'Pan',    durationMs: 2000 },
  { step: 'tilt',   label: 'Tilt',   durationMs: 2000 },
  { step: 'colour', label: 'Colour', durationMs: 1500 },
  { step: 'strobe', label: 'Strobe', durationMs: 600 },
  { step: 'reset',  label: 'Reset',  durationMs: 200 },
];

// ─── Hook ────────────────────────────────────────────────────

export function useFixtureTest() {
  const [testState, setTestState] = useState<TestState>({
    isRunning: false,
    currentStep: 'idle',
    stepLabel: '',
    progress: 0,
    elapsed: 0,
  });

  const rafRef = useRef(0);
  const startTimeRef = useRef(0);
  const stepStartRef = useRef(0);
  const seqIndexRef = useRef(0);
  const paramsRef = useRef<TestFixtureParams | null>(null);
  const stoppedRef = useRef(false);

  /** Get the 0-based DMX channel index for a given channel type (first match) */
  const findChannelOfType = useCallback((channels: FixtureChannelRaw[], type: string): number | null => {
    // Look for an exact type match first
    for (const ch of channels) {
      const chType = (ch.type || '').toLowerCase();
      if (chType === type.toLowerCase()) return ch.offset ?? 0;
    }
    return null;
  }, []);

  const findAllChannelsOfType = useCallback((channels: FixtureChannelRaw[], type: string): number[] => {
    const offsets: number[] = [];
    for (const ch of channels) {
      if ((ch.type || '').toLowerCase() === type.toLowerCase()) {
        offsets.push(ch.offset ?? 0);
      }
    }
    return offsets;
  }, []);

  const setDmxChannel = useCallback((universeIndex: number, address: number, value: number) => {
    // Written through the fixture-test arbiter source (LTP) so the test
    // overrides every other source while it runs. MERGE per channel so the
    // dimmer written at the previous step stays on during pan/tilt/colour
    // steps (write-replace would drop it), and pan+panFine co-exist in the
    // same frame.
    dmxBridge.writeMerge('fixture-test', universeIndex, { [address]: value });
  }, []);

  const stopTest = useCallback(() => {
    stoppedRef.current = true;
    cancelAnimationFrame(rafRef.current);
    // Give control back to the other sources once the test stops
    dmxBridge.release('fixture-test');
    setTestState({
      isRunning: false,
      currentStep: 'idle',
      stepLabel: '',
      progress: 0,
      elapsed: 0,
    });
  }, []);

  const startTest = useCallback((params: TestFixtureParams) => {
    const api = (window as any).lightMaestro?.dmx;
    if (!api) return;

    paramsRef.current = params;
    stoppedRef.current = false;
    seqIndexRef.current = 0;
    startTimeRef.current = performance.now();

    const channels = params.channels;
    const universeIdx = params.universeIndex;
    const startAddr = params.startAddress;

    // Pre-compute which channels exist
    const hasDimmer = findChannelOfType(channels, 'Intensity') !== null;
    const hasPan = findChannelOfType(channels, 'Pan') !== null;
    const hasTilt = findChannelOfType(channels, 'Tilt') !== null;
    const hasColour = findAllChannelsOfType(channels, 'Colour').length > 0;
    const hasShutter = findChannelOfType(channels, 'Shutter') !== null;

    /** Get the executable step sequence (skip missing attribute types) */
    const getSequence = (): typeof STEP_SEQUENCE => {
      const seq = [...STEP_SEQUENCE];
      if (!hasDimmer) seq.splice(seq.findIndex(s => s.step === 'dimmer'), 1);
      if (!hasPan) seq.splice(seq.findIndex(s => s.step === 'pan'), 1);
      if (!hasTilt) seq.splice(seq.findIndex(s => s.step === 'tilt'), 1);
      if (!hasColour) seq.splice(seq.findIndex(s => s.step === 'colour'), 1);
      if (!hasShutter) seq.splice(seq.findIndex(s => s.step === 'strobe'), 1);
      // Always keep reset
      return seq;
    };

    const sequence = getSequence();

    const tick = () => {
      if (stoppedRef.current) return;

      const now = performance.now();
      const stepIdx = seqIndexRef.current;

      if (stepIdx >= sequence.length) {
        // All steps done — ensure all channels at 0
        for (const ch of channels) {
          setDmxChannel(universeIdx, startAddr + (ch.offset ?? 0), 0);
        }
        stopTest();
        return;
      }

      const stepDef = sequence[stepIdx];
      const stepStart = stepIdx === 0 ? startTimeRef.current : stepStartRef.current;
      const elapsed = now - stepStart;
      const progress = Math.min(1, elapsed / stepDef.durationMs);

      setTestState({
        isRunning: true,
        currentStep: stepDef.step,
        stepLabel: stepDef.label,
        progress,
        elapsed: now - startTimeRef.current,
      });

      // ── Apply DMX values for current step ──
      const t = progress; // 0..1

      switch (stepDef.step) {
        case 'dimmer': {
          const dimCh = findChannelOfType(channels, 'Intensity');
          if (dimCh !== null) {
            // Ramp up then down: peak at t=0.5
            const val = t < 0.5
              ? Math.round(t * 2 * 255)
              : Math.round((1 - (t - 0.5) * 2) * 255);
            setDmxChannel(universeIdx, startAddr + dimCh, val);
          }
          break;
        }
        case 'pan': {
          const panCh = findChannelOfType(channels, 'Pan');
          if (panCh !== null) {
            // Sweep: 0→255→128 (center)
            const val = t < 0.5
              ? Math.round(t * 2 * 255)
              : Math.round(255 - (t - 0.5) * 2 * 127);
            setDmxChannel(universeIdx, startAddr + panCh, val);
            // Pan fine at max if present
            const panFine = channels.find(c => c.type === 'Pan' && c.offset !== panCh);
            if (panFine) setDmxChannel(universeIdx, startAddr + (panFine.offset ?? 0), 255);
          }
          break;
        }
        case 'tilt': {
          const tiltCh = findChannelOfType(channels, 'Tilt');
          if (tiltCh !== null) {
            // Sweep: 0→255→128 (center)
            const val = t < 0.5
              ? Math.round(t * 2 * 255)
              : Math.round(255 - (t - 0.5) * 2 * 127);
            setDmxChannel(universeIdx, startAddr + tiltCh, val);
            const tiltFine = channels.find(c => c.type === 'Tilt' && c.offset !== tiltCh);
            if (tiltFine) setDmxChannel(universeIdx, startAddr + (tiltFine.offset ?? 0), 255);
          }
          break;
        }
        case 'colour': {
          const colourChs = findAllChannelsOfType(channels, 'Colour');
          if (colourChs.length >= 3) {
            // RGB: cycle through R→G→B
            const phase = Math.floor(t * 3);
            const sub = (t * 3) - phase;
            for (const ch of colourChs) {
              const idx = colourChs.indexOf(ch);
              const val = idx === phase ? Math.round(sub * 255) : idx === (phase + 1) % 3 ? Math.round((1 - sub) * 255) : 0;
              setDmxChannel(universeIdx, startAddr + ch, val);
            }
          } else if (colourChs.length === 1) {
            // Single color wheel: sweep
            setDmxChannel(universeIdx, startAddr + colourChs[0], Math.round(t * 255));
          } else if (colourChs.length === 2) {
            // CMY: crossfade
            setDmxChannel(universeIdx, startAddr + colourChs[0], Math.round(t * 255));
            setDmxChannel(universeIdx, startAddr + colourChs[1], Math.round((1 - t) * 255));
          }
          break;
        }
        case 'strobe': {
          const shCh = findChannelOfType(channels, 'Shutter');
          if (shCh !== null) {
            // 3 fast flashes
            const flashPhase = Math.floor(t * 6);
            const val = flashPhase % 2 === 0 ? 255 : 0;
            setDmxChannel(universeIdx, startAddr + shCh, val);
          }
          break;
        }
        case 'reset': {
          // All channels to 0
          for (const ch of channels) {
            setDmxChannel(universeIdx, startAddr + (ch.offset ?? 0), 0);
          }
          break;
        }
      }

      // ── Advance to next step if current is done ──
      if (progress >= 1) {
        seqIndexRef.current++;
        stepStartRef.current = now;
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    stepStartRef.current = startTimeRef.current;
    setTestState({
      isRunning: true,
      currentStep: sequence[0]?.step ?? 'idle',
      stepLabel: sequence[0]?.label ?? '',
      progress: 0,
      elapsed: 0,
    });

    rafRef.current = requestAnimationFrame(tick);
  }, [findChannelOfType, findAllChannelsOfType, setDmxChannel, stopTest]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stoppedRef.current = true;
      cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return { testState, startTest, stopTest };
}
