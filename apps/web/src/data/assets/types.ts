export interface NetWorthHistoryRow {
  date: string;
  netWorth: number;
  assetType: string;
  source: string;
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
