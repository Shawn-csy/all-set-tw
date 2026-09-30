CREATE TABLE IF NOT EXISTS invoice_payment_accounts (
  invoice_id TEXT NOT NULL PRIMARY KEY,
  account_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE,
  FOREIGN KEY (account_id) REFERENCES bank_accounts(id)
);

CREATE INDEX IF NOT EXISTS idx_invoice_payment_accounts_account
  ON invoice_payment_accounts (account_id);
