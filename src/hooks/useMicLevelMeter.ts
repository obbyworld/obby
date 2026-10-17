import { useEffect, useState } from "react";

/** Live 0..1 audio level for a stream. We own the AudioContext and tear it
 *  down when the stream changes, so callers release nothing themselves. */
export function useMicLevelMeter(stream: MediaStream | null): number {
  const [level, setLevel] = useState(0);

  useEffect(() => {
    if (!stream) {
      setLevel(0);
      return;
    }
    let raf: number | null = null;
    let ctx: AudioContext | null = null;
    try {
      const AudioCtxCtor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      ctx = new AudioCtxCtor();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteFrequencyData(data);
        let sum = 0;
        for (const v of data) sum += v;
        setLevel(sum / data.length / 255);
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

  return level;
}
