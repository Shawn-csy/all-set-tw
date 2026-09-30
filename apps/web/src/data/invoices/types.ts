import type { ConnectorId } from "@taiwan-fin-hub/core";
import type {
  InvoiceLineSettlement,
  InvoiceLineType,
} from "@taiwan-fin-hub/core";

export interface InvoiceLineItemRow {
  id: string;
  invoiceId?: string;
  merchantId?: string;
  merchantName?: string;
  sourceId: string;
  lineNumber: number;
  description: string;
  quantity?: number;
  unitPrice?: number;
  amount: number;
  /** Cash amount after a provider-side redemption or points exchange. */
  paidAmount?: number;
  settlement?: InvoiceLineSettlement;
  lineType?: InvoiceLineType;
  classification?: {
    categoryId: string;
    label: string;
    behavior: "normal" | "asset_transfer" | "cash_withdrawal" | "excluded";
    source:
      | "override"
      | "user_rule"
      | "system_rule"
      | "merchant_product_rule"
      | "merchant_default"
      | "fallback";
    ruleId?: string;
  };
}

export interface InvoiceSummaryRow {
  id: string;
  connectorId: ConnectorId;
  sourceId: string;
  invoiceDate: string;
  invoiceNumber?: string;
  sellerName?: string;
  paymentMatchKey?: string;
  items?: InvoiceLineItemRow[];
  amount: number;
  classificationMerchant?: {
    id: string;
    name: string;
  };
}

export interface InvoiceRow extends InvoiceSummaryRow {
  items: InvoiceLineItemRow[];
}

export interface InvoiceTransactionPreference {
  invoiceId: string;
  transactionId: string | null;
  decision: "linked" | "separate" | "cash";
  updatedAt: string;
  invoiceSellerName?: string | null;
  transactionAccountId?: string | null;
}

export interface InvoicePaymentAccountRule {
  matchKey: string;
  accountId: string;
  updatedAt: string;
}

export interface InvoicePaymentAccountAssignment {
  invoiceId: string;
  accountId: string;
  updatedAt: string;
}
