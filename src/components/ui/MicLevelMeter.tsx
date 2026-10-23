import { useLingui } from "@lingui/react/macro";

const BAR_COUNT = 16;
const BAR_HEIGHTS = Array.from({ length: BAR_COUNT }, (_, i) => 30 + i * 4);

/** Bar-graph rendering of a 0..1 audio level, shared by the microphone
 *  settings field and the voice message recorder. */
export function MicLevelMeter({ level }: { level: number }) {
  const { t } = useLingui();
  return (
    <div
      className="flex h-6 items-end gap-0.5"
      role="img"
      aria-label={t`Microphone level`}
    >
      {BAR_HEIGHTS.map((height, i) => {
        const active = level >= ((i + 1) / BAR_COUNT) * 0.7;
        return (
          <div
            key={height}
            className={`w-1.5 flex-1 rounded-sm transition-colors duration-75 ${
              active ? "bg-discord-green" : "bg-discord-dark-400"
            }`}
            style={{ height: `${height}%` }}
          />
        );
      })}
    </div>
  );
}

export default MicLevelMeter;
