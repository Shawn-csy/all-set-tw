export interface MatchingTransaction {
  id: string;
  accountId?: string;
  connectorId: string;
  sourceId: string;
  accountType?: string | null;
  amount: number;
  currency: string;
  authorizedAt?: string | null;
  postedDate?: string | null;
  counterparty?: string | null;
  description?: string | null;
  excludedFromCalculation?: boolean;
  classification?: { behavior?: string };
}
export interface MatchingInvoice {
  id: string;
  invoiceDate: string;
  amount: number;
  sellerName?: string | null;
  paymentMatchKey?: string | null;
}
export interface InvoiceTransactionPreference {
  updatedAt?: string;
  invoiceId: string;
  transactionId: string | null;
  decision: "linked" | "separate" | "cash";
  invoiceSellerName?: string | null;
  transactionAccountId?: string | null;
}

export interface InvoicePaymentAccountRule {
  matchKey: string;
  accountId: string;
  updatedAt?: string;
}
export interface InvoicePaymentAccountAssignment {
  invoiceId: string;
  accountId: string;
  updatedAt?: string;
}
const TAIPEI_DAY_FORMATTER = new Intl.DateTimeFormat("en", {
  timeZone: "Asia/Taipei",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export interface InvoiceTransactionMatches<
  I extends MatchingInvoice = MatchingInvoice,
> {
  invoiceToTransactionId: Map<string, string>;
  transactionToInvoice: Map<string, I>;
  cashInvoiceIds: Set<string>;
  learnedAccountByInvoice: Map<string, string>;
  assignedAccountByInvoice: Map<string, string>;
}

const ESUN_LIFECYCLE_MARKER = /:(已入帳|未入帳):(?=\d+$)/u;

export function deduplicateBankTransactions<T extends MatchingTransaction>(
  transactions: T[],
): T[] {
  const preferredByKey = new Map<
    string,
    { transaction: T; priority: number }
  >();

  for (const transaction of transactions) {
    if (transaction.connectorId !== "esun") continue;
    const lifecycle = transaction.sourceId.match(ESUN_LIFECYCLE_MARKER)?.[1];
    const key = transaction.sourceId.replace(ESUN_LIFECYCLE_MARKER, ":");
    const priority = lifecycle == null ? 2 : lifecycle === "已入帳" ? 1 : 0;
    const current = preferredByKey.get(key);
    if (!current || priority > current.priority)
      preferredByKey.set(key, { transaction, priority });
  }

  const preferredIds = new Set(
    Array.from(preferredByKey.values(), ({ transaction }) => transaction.id),
  );
  return transactions.filter(
    (transaction) =>
      transaction.connectorId !== "esun" || preferredIds.has(transaction.id),
  );
}

export function matchInvoicesToTransactions<I extends MatchingInvoice>(
  transactions: MatchingTransaction[],
  invoices: I[],
  preferences: InvoiceTransactionPreference[] = [],
  paymentAccountRules: InvoicePaymentAccountRule[] = [],
  paymentAccounts: InvoicePaymentAccountAssignment[] = [],
): InvoiceTransactionMatches<I> {
  const invoiceById = new Map(invoices.map((invoice) => [invoice.id, invoice]));
  const transactionById = new Map(
    transactions.map((transaction) => [transaction.id, transaction]),
  );
  const invoiceToTransactionId = new Map<string, string>();
  const transactionToInvoice = new Map<string, I>();
  const cashInvoiceIds = new Set(
    preferences
      .filter(({ decision }) => decision === "cash")
      .map(({ invoiceId }) => invoiceId),
  );
  const separateInvoiceIds = new Set(
    preferences
      .filter(({ decision }) => decision === "separate" || decision === "cash")
      .map(({ invoiceId }) => invoiceId),
  );
  const learnedAccountBySeller = new Map<
    string,
    { accountId: string; updatedAt: string }
  >();

  for (const rule of paymentAccountRules) {
    if (!rule.matchKey || !rule.accountId) continue;
    const current = learnedAccountBySeller.get(rule.matchKey);
    const updatedAt = rule.updatedAt ?? "";
    if (!current || updatedAt >= current.updatedAt) {
      learnedAccountBySeller.set(rule.matchKey, {
        accountId: rule.accountId,
        updatedAt,
      });
    }
  }

  const assignedAccountByInvoice = new Map(
    paymentAccounts.map(({ invoiceId, accountId }) => [invoiceId, accountId]),
  );
  const learnedAccountByInvoice = new Map<string, string>();
  for (const invoice of invoices) {
    if (cashInvoiceIds.has(invoice.id)) continue;
    const selectedAccountId = assignedAccountByInvoice.get(invoice.id);
    const accountId =
      selectedAccountId ??
      (separateInvoiceIds.has(invoice.id)
        ? undefined
        : (
            learnedAccountBySeller.get(invoice.paymentMatchKey ?? "") ??
            learnedAccountBySeller.get(invoiceMatchKey(invoice.sellerName))
          )?.accountId);
    if (accountId) learnedAccountByInvoice.set(invoice.id, accountId);
  }

  for (const preference of preferences) {
    if (preference.decision !== "linked" || !preference.transactionId) continue;
    const invoice = invoiceById.get(preference.invoiceId);
    const transaction = transactionById.get(preference.transactionId);
    if (
      !invoice ||
      !transaction ||
      !isInvoicePaymentExpense(transaction, true) ||
      transactionToInvoice.has(transaction.id)
    )
      continue;
    invoiceToTransactionId.set(invoice.id, transaction.id);
    transactionToInvoice.set(transaction.id, invoice);
  }

  const autoInvoices = invoices.filter(
    (invoice) =>
      !separateInvoiceIds.has(invoice.id) &&
      !invoiceToTransactionId.has(invoice.id),
  );
  const autoTransactions = transactions.filter(
    (transaction) => !transactionToInvoice.has(transaction.id),
  );
  addAutomaticMatches(
    autoInvoices,
    autoTransactions,
    invoiceToTransactionId,
    transactionToInvoice,
    learnedAccountByInvoice,
  );

  return {
    invoiceToTransactionId,
    transactionToInvoice,
    cashInvoiceIds,
    learnedAccountByInvoice,
    assignedAccountByInvoice,
  };
}

export function invoiceTransactionCandidates<T extends MatchingTransaction>(
  transactions: T[],
  invoice: MatchingInvoice,
  unavailableTransactionIds: ReadonlySet<string> = new Set(),
  preferredAccountId?: string,
) {
  return transactions
    .filter(
      (transaction) =>
        !unavailableTransactionIds.has(transaction.id) &&
        isSameDayTwdExpense(transaction, invoice),
    )
    .sort((left, right) => {
      const leftPreferred =
        preferredAccountId && left.accountId === preferredAccountId ? 0 : 1;
      const rightPreferred =
        preferredAccountId && right.accountId === preferredAccountId ? 0 : 1;
      const leftMerchantScore = merchantSimilarity(invoice, left);
      const rightMerchantScore = merchantSimilarity(invoice, right);
      const leftDayDifference =
        invoiceTransactionDayDifference(left, invoice) ?? Infinity;
      const rightDayDifference =
        invoiceTransactionDayDifference(right, invoice) ?? Infinity;
      const leftDifference = Math.abs(invoice.amount - Math.abs(left.amount));
      const rightDifference = Math.abs(invoice.amount - Math.abs(right.amount));
      return (
        leftPreferred - rightPreferred ||
        rightMerchantScore - leftMerchantScore ||
        leftDifference - rightDifference ||
        leftDayDifference - rightDayDifference ||
        (left.counterparty ?? left.description ?? left.id).localeCompare(
          right.counterparty ?? right.description ?? right.id,
          "zh-TW",
        )
      );
    });
}

function addAutomaticMatches<I extends MatchingInvoice>(
  invoices: I[],
  transactions: MatchingTransaction[],
  invoiceToTransactionId: Map<string, string>,
  transactionToInvoice: Map<string, I>,
  learnedAccountByInvoice: ReadonlyMap<string, string>,
) {
  for (const invoice of [...invoices].sort(compareById)) {
    const candidates = transactions
      .filter(
        (transaction) =>
          !transactionToInvoice.has(transaction.id) &&
          (!learnedAccountByInvoice.has(invoice.id) ||
            transaction.accountId ===
              learnedAccountByInvoice.get(invoice.id)) &&
          isSameDayTwdExpense(transaction, invoice) &&
          Math.abs(transaction.amount) === invoice.amount,
      )
      .sort((left, right) =>
        compareTransactionCandidates(
          left,
          right,
          invoice,
          learnedAccountByInvoice.get(invoice.id),
        ),
      );
    const transaction = candidates[0];
    if (!transaction) continue;
    invoiceToTransactionId.set(invoice.id, transaction.id);
    transactionToInvoice.set(transaction.id, invoice);
  }
}

function isSameDayTwdExpense(
  transaction: MatchingTransaction,
  invoice: MatchingInvoice,
) {
  const transactionDate = expenseDay(transaction);
  const invoiceDate = dayNumber(invoice.invoiceDate);
  return invoiceDate != null && transactionDate === invoiceDate;
}

export function invoiceTransactionDayDifference(
  transaction: MatchingTransaction,
  invoice: MatchingInvoice,
) {
  if (!isTwdExpense(transaction)) return undefined;
  const transactionDate = expenseDay(transaction);
  const invoiceDate = dayNumber(invoice.invoiceDate);
  if (transactionDate == null || invoiceDate == null) return undefined;
  return Math.abs(transactionDate - invoiceDate);
}

const CARD_SETTLEMENT_MARKER =
  /信用卡.{0,8}(?:款|繳)|(?:繳|扣).{0,8}(?:信用卡|卡費)|卡費|credit.?card.{0,12}(?:payment|repay|bill)/iu;

/** Card bill settlement is a transfer, not a new invoice purchase. */
export function isInvoicePaymentExpense(
  transaction: Pick<
    MatchingTransaction,
    | "accountType"
    | "amount"
    | "currency"
    | "description"
    | "counterparty"
    | "excludedFromCalculation"
    | "classification"
  >,
  explicitlyLinked = false,
) {
  return (
    transaction.amount !== 0 &&
    (transaction.accountType === "credit" || transaction.amount < 0) &&
    transaction.currency === "TWD" &&
    (explicitlyLinked ||
      (!transaction.excludedFromCalculation &&
        !["asset_transfer", "cash_withdrawal", "excluded"].includes(
          transaction.classification?.behavior ?? "normal",
        ))) &&
    !CARD_SETTLEMENT_MARKER.test(
      [transaction.description, transaction.counterparty]
        .filter(Boolean)
        .join(" "),
    )
  );
}

function isTwdExpense(transaction: MatchingTransaction) {
  return isInvoicePaymentExpense(transaction);
}

function compareTransactionCandidates(
  left: MatchingTransaction,
  right: MatchingTransaction,
  invoice: MatchingInvoice,
  preferredAccountId?: string,
) {
  const leftPreferred =
    preferredAccountId && left.accountId === preferredAccountId ? 0 : 1;
  const rightPreferred =
    preferredAccountId && right.accountId === preferredAccountId ? 0 : 1;
  return (
    leftPreferred - rightPreferred ||
    merchantSimilarity(invoice, right) - merchantSimilarity(invoice, left) ||
    (invoiceTransactionDayDifference(left, invoice) ?? Infinity) -
      (invoiceTransactionDayDifference(right, invoice) ?? Infinity) ||
    compareById(left, right)
  );
}

function merchantSimilarity(
  invoice: MatchingInvoice,
  transaction: MatchingTransaction,
) {
  const invoiceText = invoiceMatchKey(invoice.sellerName);
  const transactionText = invoiceMatchKey(
    `${transaction.counterparty ?? ""} ${transaction.description ?? ""}`,
  );
  if (!invoiceText || !transactionText) return 0;
  if (
    invoiceText.length >= 3 &&
    (invoiceText.includes(transactionText) ||
      transactionText.includes(invoiceText))
  )
    return 2;
  return 0;
}

export function invoiceMatchKey(value?: string | null) {
  return (value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("zh-TW")
    .replace(/股份有限公司|有限公司|公司|有限責任?/gu, "")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "");
}

/** Match identical item content first; old merchant-only rules remain a fallback. */
export function invoicePaymentMatchKey(
  sellerName?: string | null,
  itemDescriptions: readonly string[] = [],
) {
  const sellerKey = invoiceMatchKey(sellerName);
  if (!sellerKey) return "";
  const itemKeys = itemDescriptions.map(invoiceMatchKey).filter(Boolean).sort();
  return itemKeys.length
    ? `item:${sellerKey}:${itemKeys.join(":")}`
    : sellerKey;
}

function expenseDay(transaction: MatchingTransaction) {
  if (!isInvoicePaymentExpense(transaction)) return undefined;
  return transaction.authorizedAt
    ? dayNumber(transaction.authorizedAt)
    : dateOnlyNumber(transaction.postedDate);
}

function dayNumber(value?: string | null) {
  if (!value) return undefined;
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    const parts = Object.fromEntries(
      TAIPEI_DAY_FORMATTER.formatToParts(parsed).map(({ type, value }) => [
        type,
        value,
      ]),
    );
    return (
      Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)) /
      86_400_000
    );
  }
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return undefined;
  return (
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) /
    86_400_000
  );
}

function dateOnlyNumber(value?: string | null) {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return undefined;
  return (
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) /
    86_400_000
  );
}

function compareById(left: { id: string }, right: { id: string }) {
  return left.id.localeCompare(right.id);
}
