export const queryKeys = {
  runtime: ["runtime"] as const,
  summary: ["summary"] as const,
  bank: ["bank"] as const,
  bankRange: (from: string, to: string) => ["bank", "range", from, to] as const,
  bills: ["creditCardBills"] as const,
  billsRange: (from: string, to: string) =>
    ["creditCardBills", "range", from, to] as const,
  investments: ["investments"] as const,
  investmentTransactions: ["investment-transactions"] as const,
  investmentTransactionsRange: (from: string, to: string) =>
    ["investment-transactions", "range", from, to] as const,
  invoices: ["invoices"] as const,
  invoicesRange: (from: string, to: string) =>
    ["invoices", "range", from, to] as const,
  invoiceDetail: (invoiceId: string) =>
    ["invoices", "detail", invoiceId] as const,
  invoiceTransactionMappings: ["invoice-transaction-mappings"] as const,
  invoicePaymentAccountRules: ["invoice-payment-account-rules"] as const,
  invoicePaymentAccounts: ["invoice-payment-accounts"] as const,
  manualAssets: ["manualAssets"] as const,
  exchangeRates: ["exchange-rates"] as const,
  netWorthHistory: ["netWorthHistory"] as const,
  cashWallet: ["cash-wallet"] as const,
  syncJobs: ["sync-jobs"] as const,
  latestSyncReport: ["sync-reports", "latest"] as const,
  syncReportActivities: (batchId: string) =>
    ["sync-reports", batchId, "activities"] as const,
  syncSchedule: ["sync-schedule"] as const,
  notifications: ["notifications"] as const,
  classificationCategories: ["classification-categories"] as const,
  classificationRules: ["classification-rules"] as const,
  classificationMerchants: ["classification-rules", "merchants"] as const,
  connectorSettings: (id: string) => ["connector-settings", id] as const,
  manualAssetHistory: (id: string) => ["manualAssetHistory", id] as const,
};
