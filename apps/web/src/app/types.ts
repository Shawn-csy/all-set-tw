export type PrimaryView = "overview" | "assets" | "activity" | "settings";

export type DetailView =
  | "investments"
  | "manual-assets"
  | "purchases"
  | "investment-returns"
  | "activity-analysis";

export type MobileSettingsView =
  | "data-sources"
  | "sync-notifications"
  | "exchange-rates"
  | "classification-rules";

export type View = PrimaryView | DetailView | MobileSettingsView | "more";

export interface RuntimeInfo {
  demoMode: boolean;
  deploymentMode?: "cloud-primary" | "cloud-backup" | "local-primary" | string;
  cloudBackup?: boolean;
}
