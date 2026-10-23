import { i18n } from "@lingui/core";

const MINUTE = 60;
const HOUR = 3600;
const DAY = 86400;

export function formatRelativeTime(
  time: number,
  locale: string = i18n.locale,
  now = Date.now(),
): string {
  const seconds = Math.round((time - now) / 1000);
  const format = new Intl.RelativeTimeFormat(locale || undefined, {
    numeric: "auto",
  });
  const elapsed = Math.abs(seconds);
  if (elapsed < MINUTE) return format.format(0, "second");
  if (elapsed < HOUR)
    return format.format(Math.round(seconds / MINUTE), "minute");
  if (elapsed < DAY) return format.format(Math.round(seconds / HOUR), "hour");
  if (elapsed < 7 * DAY) return format.format(Math.round(seconds / DAY), "day");
  return new Date(time).toLocaleDateString(locale || undefined);
}
