import { useEffect, useState } from "react";

// Re-renders every second while `isLive`, so elapsed times keep ticking.
export function useNow(isLive: boolean): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!isLive) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [isLive]);
  return now;
}
