import React, { createContext, useContext, useRef, useEffect, useCallback, useState } from 'react';

/**
 * Audio Capture Hook — Web Audio API + AudioWorklet
 * 
 * Captures system audio or microphone input, performs FFT analysis,
 * and sends frequency data to the main process for AutoScript.
 */

interface AudioCaptureContextType {
  isCapturing: boolean;
  startCapture: (deviceId?: string) => Promise<void>;
  stopCapture: () => void;
  analyserNode: AnalyserNode | null;
  frequencyData: Uint8Array | null;
}

const AudioCaptureContext = createContext<AudioCaptureContextType>({
  isCapturing: false,
  startCapture: async () => {},
  stopCapture: () => {},
  analyserNode: null,
  frequencyData: null,
});

export const useAudioCapture = () => useContext(AudioCaptureContext);

export const AudioCaptureProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isCapturing, setIsCapturing] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);

  const startCapture = useCallback(async (deviceId?: string) => {
    try {
      const ctx = new AudioContext();
      audioContextRef.current = ctx;

      // Try to capture system audio if supported, fallback to mic
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          // Some browsers support 'monitor' for system audio capture
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });

      streamRef.current = stream;
      const source = ctx.createMediaStreamSource(stream);

      // Create analyser node (FFT size 2048 for good frequency resolution)
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.8;
      analyserRef.current = analyser;

      source.connect(analyser);

      // Don't connect to destination (no feedback loop)
      // analyser.connect(ctx.destination) — uncomment to hear audio

      setIsCapturing(true);

      // Start analysis loop
      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Float32Array(bufferLength);

      const analyze = () => {
        if (!analyserRef.current || !audioContextRef.current) return;

        // Get frequency data
        analyserRef.current.getFloatFrequencyData(dataArray);

        // Convert dB to linear scale and normalize
        for (let i = 0; i < bufferLength; i++) {
          // Convert from dB (-100 to -30) to linear 0-1
          dataArray[i] = Math.pow(10, (Math.max(-100, dataArray[i]) + 100) / 100) - 1;
          dataArray[i] = Math.max(0, Math.min(1, dataArray[i] * 2));
        }

        // Send to main process via preload bridge
        if (window.lightMaestro?.audio?.pushBuffer) {
          window.lightMaestro.audio.pushBuffer(dataArray);
        }

        rafRef.current = requestAnimationFrame(analyze);
      };

      analyze();
    } catch (err) {
      console.error('Failed to start audio capture:', err);
      throw err;
    }
  }, []);

  const stopCapture = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    analyserRef.current = null;
    setIsCapturing(false);
  }, []);

  useEffect(() => {
    return () => {
      stopCapture();
    };
  }, [stopCapture]);

  return (
    <AudioCaptureContext.Provider
      value={{
        isCapturing,
        startCapture,
        stopCapture,
        analyserNode: analyserRef.current,
        frequencyData: null,
      }}
    >
      {children}
    </AudioCaptureContext.Provider>
  );
};
