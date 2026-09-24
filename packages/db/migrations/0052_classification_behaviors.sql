-- Classification is the single source of truth for how an activity affects
-- cash flow. The legacy rule and transaction preference columns remain in the
-- schema for old sync statements, but are migrated and no longer read by the
-- application.
ALTER TABLE classification_categories
  ADD COLUMN behavior TEXT NOT NULL DEFAULT 'normal'
  CHECK (behavior IN ('normal', 'asset_transfer', 'cash_withdrawal', 'excluded'));

CREATE INDEX idx_classification_categories_behavior
  ON classification_categories (behavior);

INSERT OR IGNORE INTO classification_categories
  (id, label, sort_order, is_system, behavior, created_at, updated_at)
VALUES
  ('cash-withdrawal', '提款至現金', 90, 1, 'cash_withdrawal',
   '2026-09-24T00:00:00.000Z', '2026-09-24T00:00:00.000Z'),
  ('excluded', '不列入統計', 91, 1, 'excluded',
   '2026-09-24T00:00:00.000Z', '2026-09-24T00:00:00.000Z');

UPDATE classification_categories
SET behavior = 'asset_transfer',
    updated_at = '2026-09-24T00:00:00.000Z'
WHERE id IN ('transfer', 'investment');

UPDATE classification_categories
SET behavior = 'excluded',
    updated_at = '2026-09-24T00:00:00.000Z'
WHERE id = 'fee';

-- Preserve old rule actions by moving ordinary categories to the explicit
-- special category. Existing transfer/investment/fee categories already carry
-- equivalent non-consumption behavior.
UPDATE classification_rules
SET category_id = 'excluded',
    excluded_from_calculation = 0,
    updated_at = '2026-09-24T00:00:00.000Z'
WHERE excluded_from_calculation = 1
  AND category_id NOT IN ('transfer', 'investment', 'fee');

UPDATE classification_rules
SET excluded_from_calculation = 0,
    updated_at = '2026-09-24T00:00:00.000Z'
WHERE excluded_from_calculation = 1;

-- Materialize transaction-level legacy settings as ordinary classification
-- overrides. A cash withdrawal wins over a legacy exclusion because it has a
-- more specific cash-wallet meaning.
INSERT INTO classification_overrides
  (id, target_type, target_id, category_id, created_at, updated_at)
SELECT
  'override:bank_transaction:' || p.transaction_id,
  'bank_transaction',
  p.transaction_id,
  'cash-withdrawal',
  p.created_at,
  p.updated_at
FROM bank_transaction_preferences p
WHERE p.cash_withdrawal = 1
ON CONFLICT(target_type, target_id) DO UPDATE SET
  category_id = excluded.category_id,
  updated_at = excluded.updated_at;

INSERT INTO classification_overrides
  (id, target_type, target_id, category_id, created_at, updated_at)
SELECT
  'override:bank_transaction:' || p.transaction_id,
  'bank_transaction',
  p.transaction_id,
  'cash-withdrawal',
  p.created_at,
  p.updated_at
FROM cash_withdrawal_preferences p
WHERE 1 = 1
ON CONFLICT(target_type, target_id) DO UPDATE SET
  category_id = excluded.category_id,
  updated_at = excluded.updated_at;

INSERT INTO classification_overrides
  (id, target_type, target_id, category_id, created_at, updated_at)
SELECT
  'override:bank_transaction:' || p.transaction_id,
  'bank_transaction',
  p.transaction_id,
  'excluded',
  p.created_at,
  p.updated_at
FROM bank_transaction_preferences p
WHERE p.excluded_from_calculation = 1
  AND p.cash_withdrawal = 0
  AND NOT EXISTS (
    SELECT 1
    FROM cash_withdrawal_preferences c
    WHERE c.transaction_id = p.transaction_id
  )
  AND 1 = 1
ON CONFLICT(target_type, target_id) DO UPDATE SET
  category_id = excluded.category_id,
  updated_at = excluded.updated_at
WHERE classification_overrides.category_id <> 'cash-withdrawal';

UPDATE bank_transaction_preferences
SET excluded_from_calculation = 0,
    cash_withdrawal = 0,
    updated_at = '2026-09-24T00:00:00.000Z'
WHERE excluded_from_calculation = 1 OR cash_withdrawal = 1;
