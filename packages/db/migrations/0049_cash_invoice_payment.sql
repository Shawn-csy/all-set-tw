CREATE TABLE invoice_transaction_preferences_new (
  invoice_id TEXT NOT NULL PRIMARY KEY REFERENCES invoices (id),
  transaction_id TEXT REFERENCES bank_transactions (id),
  decision TEXT NOT NULL CHECK (decision IN ('linked', 'separate', 'cash')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    (decision = 'linked' AND transaction_id IS NOT NULL)
    OR decision IN ('separate', 'cash')
  )
);

INSERT INTO invoice_transaction_preferences_new
  (invoice_id, transaction_id, decision, created_at, updated_at)
SELECT invoice_id, transaction_id, decision, created_at, updated_at
FROM invoice_transaction_preferences;

DROP TABLE invoice_transaction_preferences;
ALTER TABLE invoice_transaction_preferences_new RENAME TO invoice_transaction_preferences;
CREATE UNIQUE INDEX idx_invoice_transaction_preferences_linked_transaction
  ON invoice_transaction_preferences (transaction_id)
  WHERE decision = 'linked';
CREATE INDEX idx_invoice_transaction_preferences_transaction
  ON invoice_transaction_preferences (transaction_id);
