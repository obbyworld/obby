const STATUS_PRIORITY: Record<string, number> = {
  "~": 6,
  "&": 5,
  "@": 4,
  "%": 3,
  "+": 2,
};

/** Rank of the highest channel prefix in `status`, where 1 is a plain member. */
export function getStatusPriority(status?: string): number {
  return Math.max(
    1,
    ...[...(status ?? "")].map((c) => STATUS_PRIORITY[c] ?? 1),
  );
}

/** Halfops and everyone above them can kick, ban and change modes. */
export function canModerate(status?: string): boolean {
  return getStatusPriority(status) >= STATUS_PRIORITY["%"];
}
