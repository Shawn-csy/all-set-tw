export interface NetWorthHistoryRow {
  date: string;
  netWorth: number;
  assetType: string;
  source: string;
  /** Stable source-side series key; manual assets may share the same assetType. */
  seriesId?: string;
}

export interface ExchangeRateRow {
  currency: string;
  rateTwd: number;
  updatedAt: string;
}

export interface ManualAssetRow {
  id: string;
  name: string;
  category: string;
  note: string | null;
  symbol?: string | null;
  quantity?: number | null;
  costPerShare?: number | null;
  marketPrice?: number | null;
  marketPriceAsOf?: string | null;
  marketPriceProvider?: string | null;
  currency: string;
  createdAt: string;
  value?: number;
  date?: string;
}

export interface ManualAssetHistoryEntry {
  date: string;
  value: number;
}

export interface CashWalletRow {
  openingBalance: number;
  cashWithdrawals: number;
  cashExpenses: number;
  balance: number;
  currency: "TWD";
  updatedAt: string | null;
}
