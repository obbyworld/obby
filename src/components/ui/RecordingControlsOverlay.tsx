import { Trans, useLingui } from "@lingui/react/macro";
import { useCallback, useEffect, useState } from "react";
import { FaCircle, FaStop, FaTimes } from "react-icons/fa";
import {
  requestRecordingCancel,
  requestRecordingStop,
} from "../../lib/screenRegion";

function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** The bar beside the area being recorded. It is the only thing a person has
 *  to find to stop, so it carries the clock, both endings, and the keys for
 *  them. */
export function RecordingControlsOverlay() {
  const { t } = useLingui();
  const [elapsedMs, setElapsedMs] = useState(0);
  const [failed, setFailed] = useState(false);

  // This window reaches the app over the event bridge, and a window without
  // permission for it is refused silently, which looks exactly like a dead
  // button. Saying so beats leaving someone pressing it.
  const ask = useCallback((request: () => Promise<void>) => {
    request().catch((err) => {
      console.error("recording control failed", err);
      setFailed(true);
    });
  }, []);

  useEffect(() => {
    const startedAt = Date.now();
    const tick = window.setInterval(
      () => setElapsedMs(Date.now() - startedAt),
      250,
    );
    return () => window.clearInterval(tick);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") ask(requestRecordingCancel);
      if (event.key === "Enter") ask(requestRecordingStop);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [ask]);

  return (
    <div
      data-testid="recording-controls"
      className="flex h-full w-full items-center gap-3 rounded-lg bg-discord-dark-200/95 px-3 shadow-lg"
    >
      <FaCircle className="h-2.5 w-2.5 animate-pulse text-red-500" />
      <span className="font-mono text-lg tabular-nums text-discord-text-normal">
        {failed ? "!" : formatElapsed(elapsedMs)}
      </span>
      <button
        type="button"
        onClick={() => ask(requestRecordingStop)}
        className="ml-auto flex min-h-9 items-center gap-2 rounded button-primary px-3 text-sm"
      >
        <FaStop />
        <Trans>Stop</Trans>
      </button>
      <button
        type="button"
        onClick={() => ask(requestRecordingCancel)}
        aria-label={t`Discard`}
        className="flex h-9 w-9 items-center justify-center rounded text-discord-text-muted hover:bg-discord-dark-400 hover:text-discord-text-normal"
      >
        <FaTimes />
      </button>
    </div>
  );
}

export default RecordingControlsOverlay;
