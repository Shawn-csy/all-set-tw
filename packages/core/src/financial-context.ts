export type FinancialContextCurrencyValue = {
  currency: string;
  value: number | null;
  valueTwd: number | null;
};

export type FinancialContextExport = {
  schema: "taiwan-fin-hub.ai-financial-context";
  schemaVersion: 1;
  generatedAt: string;
  baseCurrency: "TWD";
  period: {
    from: string;
    to: string;
    days: number;
  };
  instructionsForAi: string[];
  summary: {
    assets: {
      cash: FinancialContextCurrencyValue[];
      investments: FinancialContextCurrencyValue[];
      other: FinancialContextCurrencyValue[];
      totalTwd: number | null;
    };
    liabilities: {
      creditCards: FinancialContextCurrencyValue[];
      loans: FinancialContextCurrencyValue[];
      totalTwd: number | null;
    };
    cashWallet: {
      currency: string;
      balance: number;
      openingBalance: number;
      cashWithdrawals: number;
      cashExpenses: number;
    };
    netWorthEstimateTwd: number | null;
    valuationStatus: "complete" | "partial" | "unavailable";
    cashFlow: Array<{
      currency: string;
      income: number;
      expenses: number;
      investmentContributions: number;
      investmentIncome: number;
      transfers: number;
      netCashFlow: number;
    }>;
  };
  accounts: Array<{
    institution: string | null;
    name: string | null;
    type: string | null;
    role: "asset" | "liability";
    currency: string;
    last4: string | null;
    balance: number | null;
    availableBalance: number | null;
    asOfAt: string | null;
  }>;
  spending: {
    byCategory: Array<{
      categoryId: string;
      category: string;
      currency: string;
      amount: number;
      transactionCount: number;
    }>;
    byMonth: Array<{
      month: string;
      currency: string;
      income: number;
      expenses: number;
      investmentContributions: number;
      investmentIncome: number;
      transfers: number;
      netCashFlow: number;
    }>;
    topMerchants: Array<{
      merchant: string;
      currency: string;
      amount: number;
      transactionCount: number;
    }>;
    transactions: Array<{
      date: string;
      source: "bank" | "card" | "invoice";
      flow: "income" | "expense" | "investment" | "transfer";
      description: string;
      category: string;
      categoryId: string;
      amount: number | null;
      currency: string;
      excludedFromCalculation: boolean;
      classificationSource: string | null;
    }>;
  };
  investments: {
    holdings: Array<{
      source: "synced" | "manual";
      name: string;
      symbol: string | null;
      assetType: string;
      quantity: number | null;
      marketValue: number | null;
      cashBalance: number | null;
      costBasis: number | null;
      unrealizedPnl: number | null;
      currency: string;
      asOfDate: string;
      valuationStatus: "valued" | "missing";
      investorNote?: string;
    }>;
    transactions: Array<{
      date: string;
      action: string;
      symbol: string | null;
      name: string | null;
      assetType: string | null;
      quantity: number | null;
      price: number | null;
      amount: number | null;
      amountSource: string;
      currency: string;
    }>;
    decisionSignals: {
      observations: Array<{
        date: string;
        decision: "buy" | "sell" | "dividend" | "fee" | "other";
        confidence: "high" | "medium" | "low";
        symbol: string | null;
        name: string | null;
        evidence: {
          transactionCode: string | null;
          transactionName: string | null;
        };
        amount: number | null;
        currency: string;
      }>;
      manualNotes: Array<{
        symbol: string | null;
        name: string;
        note: string;
      }>;
      limitations: string[];
    };
    totals: {
      marketValue: FinancialContextCurrencyValue[];
      costBasis: FinancialContextCurrencyValue[];
      unrealizedPnl: FinancialContextCurrencyValue[];
    };
  };
  dataQuality: {
    sourceCounts: {
      accounts: number;
      bankTransactions: number;
      invoices: number;
      investmentTransactions: number;
      holdings: number;
      otherAssets: number;
    };
    latestDataAt: {
      accounts: string | null;
      holdings: string | null;
      otherAssets: string | null;
      exchangeRates: string | null;
    };
    missingExchangeRates: string[];
    missingValuations: number;
    truncated: boolean;
    omittedSensitiveFields: string[];
    limitations: string[];
  };
};
