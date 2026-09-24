ALTER TABLE bank_transaction_preferences
  ADD COLUMN cash_withdrawal INTEGER NOT NULL DEFAULT 0
  CHECK (cash_withdrawal IN (0, 1));

CREATE TABLE cash_wallet_settings (
  id TEXT NOT NULL PRIMARY KEY CHECK (id = 'default'),
  opening_balance INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'TWD' CHECK (currency = 'TWD'),
  updated_at TEXT NOT NULL
);

INSERT INTO cash_wallet_settings (id, opening_balance, currency, updated_at)
VALUES ('default', 0, 'TWD', datetime('now'));
