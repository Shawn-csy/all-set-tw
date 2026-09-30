CREATE TABLE IF NOT EXISTS invoice_payment_account_rules (
  match_key TEXT NOT NULL PRIMARY KEY,
  account_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (account_id) REFERENCES bank_accounts(id)
);

CREATE INDEX IF NOT EXISTS idx_invoice_payment_account_rules_account
  ON invoice_payment_account_rules (account_id);
