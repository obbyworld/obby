import { useEffect, useState } from "react";

export interface MicLevel {
  /** Live 0..1 audio level. */
  level: number;
  /** Turns true at the first real sample. A device that is still switching
   *  over (a Bluetooth headset moving to its microphone mode, an OS
   *  reconfiguring the input) delivers exact zeros, while a live microphone
   *  always carries some signal. */
  hasSound: boolean;
}

/** We own the AudioContext and tear it down when the stream changes, so
 *  callers release nothing themselves. */
export function useMicLevelMeter(stream: MediaStream | null): MicLevel {
  const [level, setLevel] = useState(0);
  const [hasSound, setHasSound] = useState(false);

  useEffect(() => {
    setLevel(0);
    setHasSound(false);
    if (!stream) return;
    let raf: number | null = null;
    let ctx: AudioContext | null = null;
    try {
      const AudioCtxCtor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      ctx = new AudioCtxCtor();
      void ctx.resume();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      const samples = new Float32Array(analyser.fftSize);
      let heard = false;
      const tick = () => {
        analyser.getByteFrequencyData(data);
        let sum = 0;
        for (const v of data) sum += v;
        setLevel(sum / data.length / 255);
        if (!heard) {
          analyser.getFloatTimeDomainData(samples);
          heard = samples.some((s) => s !== 0);
          if (heard) setHasSound(true);
        }
        raf = requestAnimationFrame(tick);
      };
      tick();
    } catch {
      // The meter is a nice-to-have; callers still work without it.
    }
    return () => {
      if (raf !== null) cancelAnimationFrame(raf);
      if (ctx) void ctx.close();
    };
  }, [stream]);

  return { level, hasSound };
}
