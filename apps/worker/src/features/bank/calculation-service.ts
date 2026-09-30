import {
  bankTransactionIsCashWithdrawalCandidate,
  bankTransactionExists,
} from "./calculation-repository";
import {
  deleteClassificationOverride,
  findClassificationOverride,
  upsertClassificationOverride,
} from "../classification/repository";
import type { ClassificationBehavior } from "../classification/service";

export type CalculationTransaction = {
  transferPeerId?: string | null;
  accountType?: string | null;
  description?: string | null;
  counterparty?: string | null;
  calculationPreference?: number | null;
  classificationExcludedFromCalculation?: boolean | null;
  classificationBehavior?: ClassificationBehavior | null;
  classificationSource?:
    | "override"
    | "user_rule"
    | "system_rule"
    | "merchant_product_rule"
    | "merchant_default"
    | "auto_transfer"
    | "auto_offset"
    | "fallback"
    | null;
};

export class BankTransactionNotFoundError extends Error {}
export class BankTransactionNotCashWithdrawalError extends Error {}

function calculationText(transaction: CalculationTransaction) {
  const normalized =
    `${transaction.description ?? ""} ${transaction.counterparty ?? ""}`
      .normalize("NFKC")
      .toLowerCase();
  return {
    compact: normalized.replace(/[\s\p{P}\p{S}]+/gu, ""),
    words: normalized.replace(/[^a-z0-9]+/g, " ").trim(),
  };
}

export function isDefaultCalculationExcluded(
  transaction: CalculationTransaction,
) {
  if (transaction.accountType === "time_deposit" && transaction.transferPeerId)
    return true;
  const { compact, words } = calculationText(transaction);
  const paddedWords = ` ${words} `;

  if (compact.includes("卡費") || compact.includes("繳卡款")) return true;
  if (compact.includes("繳信用卡")) return true;
  if (
    compact.includes("信用卡") &&
    ["繳款", "扣款", "還款", "自扣", "自動扣繳"].some((keyword) =>
      compact.includes(keyword),
    )
  )
    return true;
  if (paddedWords.includes(" card payment ")) return true;

  if (transaction.accountType === "credit") {
    if (compact.includes("繳款入帳") || compact.includes("自扣已入帳"))
      return true;
    if (paddedWords.includes(" payment received ")) return true;
  }

  return false;
}

export function resolveCalculationExclusion(
  transaction: CalculationTransaction,
) {
  if (
    transaction.calculationPreference === 0 ||
    transaction.calculationPreference === 1
  ) {
    return transaction.calculationPreference === 1;
  }
  if (transaction.classificationExcludedFromCalculation) return true;
  if (
    transaction.classificationSource === "override" ||
    transaction.classificationSource === "user_rule"
  ) {
    return transaction.classificationBehavior !== "normal";
  }
  if (
    transaction.classificationBehavior === "excluded" ||
    transaction.classificationBehavior === "asset_transfer" ||
    transaction.classificationBehavior === "cash_withdrawal"
  )
    return true;
  return isDefaultCalculationExcluded(transaction);
}

export async function setCalculationPreference(
  db: D1Database,
  transactionId: string,
  excludedFromCalculation: boolean,
) {
  if (!(await bankTransactionExists(db, transactionId))) {
    throw new BankTransactionNotFoundError();
  }
  const now = new Date().toISOString();
  if (excludedFromCalculation) {
    await upsertClassificationOverride(db, {
      targetType: "bank_transaction",
      targetId: transactionId,
      categoryId: "excluded",
      now,
    });
    return;
  }

  const current = await findClassificationOverride(
    db,
    "bank_transaction",
    transactionId,
  );
  if (current?.categoryId === "excluded") {
    await deleteClassificationOverride(db, "bank_transaction", transactionId);
  }
}

export async function setCashWithdrawalPreference(
  db: D1Database,
  transactionId: string,
  cashWithdrawal: boolean,
) {
  if (!(await bankTransactionExists(db, transactionId))) {
    throw new BankTransactionNotFoundError();
  }
  if (!(await bankTransactionIsCashWithdrawalCandidate(db, transactionId))) {
    throw new BankTransactionNotCashWithdrawalError();
  }
  const now = new Date().toISOString();
  if (cashWithdrawal) {
    await upsertClassificationOverride(db, {
      targetType: "bank_transaction",
      targetId: transactionId,
      categoryId: "cash-withdrawal",
      now,
    });
    return;
  }

  const current = await findClassificationOverride(
    db,
    "bank_transaction",
    transactionId,
  );
  if (current?.categoryId === "cash-withdrawal") {
    await deleteClassificationOverride(db, "bank_transaction", transactionId);
  }
}
