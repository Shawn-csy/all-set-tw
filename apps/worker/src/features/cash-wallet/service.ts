import {
  getCashWallet as getCashWalletRecord,
  setCashWalletOpeningBalance,
} from "./repository";

export function getCashWallet(db: D1Database) {
  return getCashWalletRecord(db);
}

export async function updateCashWallet(db: D1Database, openingBalance: number) {
  await setCashWalletOpeningBalance(
    db,
    openingBalance,
    new Date().toISOString(),
  );
  return getCashWalletRecord(db);
}
