CREATE TABLE investment_position_cost_overrides (
  id TEXT NOT NULL PRIMARY KEY,
  connector_id TEXT NOT NULL,
  holding_key TEXT NOT NULL,
  cost_per_share REAL NOT NULL CHECK (cost_per_share > 0),
  currency TEXT NOT NULL DEFAULT 'TWD',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (connector_id, holding_key)
);

CREATE INDEX idx_investment_position_cost_overrides_source
  ON investment_position_cost_overrides (connector_id, holding_key);
