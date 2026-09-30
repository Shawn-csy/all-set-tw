CREATE TABLE IF NOT EXISTS classification_merchants (
  id TEXT NOT NULL PRIMARY KEY,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  default_category_id TEXT,
  is_system INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (default_category_id) REFERENCES classification_categories (id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_classification_merchants_normalized_name
  ON classification_merchants (normalized_name COLLATE NOCASE);

CREATE INDEX IF NOT EXISTS idx_classification_merchants_default_category
  ON classification_merchants (default_category_id);

CREATE TABLE IF NOT EXISTS classification_merchant_rules (
  id TEXT NOT NULL PRIMARY KEY,
  merchant_id TEXT NOT NULL,
  target_type TEXT CHECK (
    target_type IS NULL OR target_type IN ('bank_transaction', 'invoice_item')
  ),
  field TEXT NOT NULL CHECK (
    field IN ('merchant_name', 'description', 'counterparty', 'any_text', 'source_id')
  ),
  operator TEXT NOT NULL CHECK (
    operator IN ('contains', 'equals', 'starts_with', 'regex')
  ),
  pattern TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 100,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  is_system INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0, 1)),
  source TEXT NOT NULL DEFAULT 'user',
  description TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (merchant_id) REFERENCES classification_merchants (id)
);

CREATE INDEX IF NOT EXISTS idx_classification_merchant_rules_merchant_priority
  ON classification_merchant_rules (merchant_id, enabled, target_type, priority);

CREATE TABLE IF NOT EXISTS classification_merchant_product_rules (
  id TEXT NOT NULL PRIMARY KEY,
  merchant_id TEXT NOT NULL,
  category_id TEXT NOT NULL,
  target_type TEXT CHECK (
    target_type IS NULL OR target_type IN ('bank_transaction', 'invoice_item')
  ),
  field TEXT NOT NULL CHECK (
    field IN ('description', 'counterparty', 'any_text', 'source_id')
  ),
  operator TEXT NOT NULL CHECK (
    operator IN ('contains', 'equals', 'starts_with', 'regex')
  ),
  pattern TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 100,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  is_system INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0, 1)),
  source TEXT NOT NULL DEFAULT 'user',
  description TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (merchant_id) REFERENCES classification_merchants (id),
  FOREIGN KEY (category_id) REFERENCES classification_categories (id)
);

CREATE INDEX IF NOT EXISTS idx_classification_merchant_product_rules_lookup
  ON classification_merchant_product_rules (merchant_id, enabled, target_type, priority);

CREATE INDEX IF NOT EXISTS idx_classification_merchant_product_rules_category
  ON classification_merchant_product_rules (category_id);
