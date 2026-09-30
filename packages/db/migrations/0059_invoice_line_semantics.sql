ALTER TABLE invoice_line_items
  ADD COLUMN line_type TEXT NOT NULL DEFAULT 'item'
  CHECK (line_type IN ('item', 'allowance', 'refund', 'fee'));

CREATE TABLE IF NOT EXISTS invoice_merchant_overrides (
  invoice_id TEXT NOT NULL PRIMARY KEY,
  merchant_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE,
  FOREIGN KEY (merchant_id) REFERENCES classification_merchants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_invoice_merchant_overrides_merchant
  ON invoice_merchant_overrides (merchant_id);
