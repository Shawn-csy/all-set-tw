CREATE TABLE cash_withdrawal_preferences (
  transaction_id TEXT NOT NULL PRIMARY KEY REFERENCES bank_transactions (id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_cash_withdrawal_preferences_updated
  ON cash_withdrawal_preferences (updated_at);

INSERT INTO cash_withdrawal_preferences (transaction_id, created_at, updated_at)
SELECT transaction_id, created_at, updated_at
FROM bank_transaction_preferences
WHERE cash_withdrawal = 1;
