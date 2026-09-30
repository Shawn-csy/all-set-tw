import type { ConnectorId } from "@taiwan-fin-hub/core";

export interface InvestmentRow {
  id: string;
  connectorId?: ConnectorId;
  sourceId?: string;
  assetType: "stock" | "etf" | "fund";
  symbol?: string;
  name: string;
  quantity?: number;
  marketValue?: number;
  cashBalance?: number;
  costPerShare?: number | null;
  costBasis?: number | null;
  marketPrice?: number | null;
  marketPriceAsOf?: string | null;
  marketPriceProvider?: string | null;
  isManual?: boolean;
  currency: string;
  asOfDate: string;
}

export interface InvestmentTransactionRow {
  id: string;
  connectorId: ConnectorId;
  accountId: string;
  sourceId: string;
  brokerNo?: string;
  brokerAccount?: string;
  brokerName?: string;
  symbol?: string;
  name?: string;
  assetType?: "stock" | "etf" | "fund" | "bond" | "unknown";
  tradeDate?: string;
  postedDate?: string;
  transactionCode?: string;
  transactionName?: string;
  quantity?: number;
  price?: number;
  amount?: number;
  rawAmount?: number;
  amountSource?: "synced" | "manual" | "historical-close" | "missing";
  amountReferencePrice?: number | null;
  amountPriceDate?: string | null;
  amountProvider?: string | null;
  currency: string;
}
