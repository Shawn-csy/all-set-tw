import type { View } from "./types";

const views = new Set<View>([
  "overview",
  "assets",
  "activity",
  "settings",
  "investments",
  "manual-assets",
  "purchases",
  "activity-analysis",
  "investment-returns",
  "data-sources",
  "sync-notifications",
  "exchange-rates",
  "classification-rules",
  "ai-export",
  "more",
]);

export function parseViewHash(hash: string): View | null {
  const candidate = hash.replace(/^#\/?/, "");
  return views.has(candidate as View) ? (candidate as View) : null;
}

export function viewHash(view: View) {
  return `#/${view}`;
}
