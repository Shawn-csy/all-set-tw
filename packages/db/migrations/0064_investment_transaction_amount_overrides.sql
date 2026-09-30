CREATE TABLE investment_transaction_amount_overrides (
  id TEXT NOT NULL PRIMARY KEY,
  transaction_id TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (transaction_id)
);

CREATE INDEX idx_investment_transaction_amount_overrides_transaction
  ON investment_transaction_amount_overrides (transaction_id);
