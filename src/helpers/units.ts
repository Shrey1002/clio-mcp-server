/** Activity `quantity` is SECONDS on API >= 4.0.4. Convert at the tool boundary. */
export const hoursToSeconds = (h: number) => Math.round(h * 3600);
export const secondsToHours = (s: number) => Math.round((s / 3600) * 10000) / 10000;

const CANON = {
  address: ["Work", "Home", "Billing", "Other"],
  email: ["Work", "Home", "Other"],
  phone: ["Work", "Home", "Mobile", "Fax", "Other"],
} as const;

/** Clio enum-validates the label ("Business" => 422). Coerce anything unknown/missing to Work. */
export function normalizeLabel(kind: keyof typeof CANON, v: string | undefined): string {
  const hit = CANON[kind].find((c) => c.toLowerCase() === (v ?? "").trim().toLowerCase());
  return hit ?? "Work";
}
