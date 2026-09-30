import { queryOptions } from "@tanstack/svelte-query";
import type { CreateQueryOptions } from "@tanstack/svelte-query";
import type { ApiClient } from "@/shared/api/client";
import { queryKeys } from "@/shared/api/query-keys";
import { resolveInvoiceLineSettlements } from "@taiwan-fin-hub/core";
import type { MonthRange } from "@/shared/date-range";
import type {
  InvoicePaymentAccountRule,
  InvoicePaymentAccountAssignment,
  InvoiceRow,
  InvoiceSummaryRow,
  InvoiceTransactionPreference,
} from "./types";

type ApiProvider = () => ApiClient;

function withInvoiceLineSettlements<T extends InvoiceSummaryRow>(
  invoice: T,
): T {
  if (!invoice.items?.length) return invoice;
  const settlements = resolveInvoiceLineSettlements(
    invoice.amount,
    invoice.items,
  );
  return {
    ...invoice,
    items: invoice.items.map((line, index) => ({
      ...line,
      paidAmount: settlements[index]?.paidAmount ?? Math.max(0, line.amount),
      settlement: settlements[index]?.settlement ?? "paid",
    })),
  };
}

export const invoicesRangeQuery = (getApi: ApiProvider, range: MonthRange) =>
  queryOptions({
    queryKey: queryKeys.invoicesRange(range.from, range.to),
    queryFn: async () => {
      const invoices = await getApi().get<InvoiceSummaryRow[]>(
        `/api/invoices?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}&includeItems=1`,
      );
      return invoices.map(withInvoiceLineSettlements);
    },
  });

export const invoicesQuery = (
  getApi: ApiProvider,
  range?: MonthRange,
): CreateQueryOptions<InvoiceSummaryRow[]> => ({
  queryKey: range
    ? queryKeys.invoicesRange(range.from, range.to)
    : queryKeys.invoices,
  queryFn: async () => {
    const invoices = await getApi().get<InvoiceSummaryRow[]>(
      range
        ? `/api/invoices?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}&includeItems=1`
        : "/api/invoices",
    );
    return invoices.map(withInvoiceLineSettlements);
  },
});

export const invoiceDetailQuery = (
  getApi: ApiProvider,
  invoiceId: string | null,
) =>
  queryOptions({
    queryKey: queryKeys.invoiceDetail(invoiceId ?? ""),
    queryFn: async () =>
      withInvoiceLineSettlements(
        await getApi().get<InvoiceRow>(
          `/api/invoices/${encodeURIComponent(invoiceId ?? "")}`,
        ),
      ),
    enabled: Boolean(invoiceId),
  });

export const invoiceTransactionMappingsQuery = (getApi: ApiProvider) =>
  queryOptions({
    queryKey: queryKeys.invoiceTransactionMappings,
    queryFn: () =>
      getApi().get<InvoiceTransactionPreference[]>(
        "/api/activity/invoice-mappings",
      ),
  });

export const invoicePaymentAccountRulesQuery = (getApi: ApiProvider) =>
  queryOptions({
    queryKey: queryKeys.invoicePaymentAccountRules,
    queryFn: () =>
      getApi().get<InvoicePaymentAccountRule[]>(
        "/api/activity/invoice-payment-rules",
      ),
  });

export const invoicePaymentAccountsQuery = (getApi: ApiProvider) =>
  queryOptions({
    queryKey: queryKeys.invoicePaymentAccounts,
    queryFn: () =>
      getApi().get<InvoicePaymentAccountAssignment[]>(
        "/api/activity/invoice-payment-accounts",
      ),
  });
