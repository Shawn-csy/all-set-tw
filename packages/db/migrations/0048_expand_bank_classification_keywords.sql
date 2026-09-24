-- Keep system rules aligned with the descriptions emitted by Taiwanese bank
-- connectors. User rules and transaction-level overrides are not changed.
UPDATE classification_rules
SET pattern = '投資|證券|股票|台股|美股|基金|etf|broker|tdcc|複委託|定期定額|交割|(^|\s)\d{4,6}(?=\s|$)',
    updated_at = '2026-09-24T00:00:00.000Z'
WHERE id = 'system:bank:investment-keywords'
  AND is_system = 1;

UPDATE classification_rules
SET pattern = '信用卡.*繳|繳卡費|信用卡款|credit.?card.*(pay|bill|repay)',
    updated_at = '2026-09-24T00:00:00.000Z'
WHERE id = 'system:bank:creditcard-payment'
  AND is_system = 1;

UPDATE classification_rules
SET pattern = '購物|商店|百貨|超商|market|store|shop|momo|pchome|costco|全聯|統一|seven|family|ikea|宜家',
    updated_at = '2026-09-24T00:00:00.000Z'
WHERE id = 'system:bank:shopping-keywords'
  AND is_system = 1;
