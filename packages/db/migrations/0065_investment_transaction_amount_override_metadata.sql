ALTER TABLE investment_transaction_amount_overrides
  ADD COLUMN source TEXT NOT NULL DEFAULT 'manual'
  CHECK (source IN ('manual', 'historical-close'));

ALTER TABLE investment_transaction_amount_overrides
  ADD COLUMN reference_price REAL;

ALTER TABLE investment_transaction_amount_overrides
  ADD COLUMN price_date TEXT;

ALTER TABLE investment_transaction_amount_overrides
  ADD COLUMN provider TEXT;
