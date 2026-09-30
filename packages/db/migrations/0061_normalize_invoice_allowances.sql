-- Older e-invoice detail payloads stored discount / points rows as ordinary
-- items. Their negative amount is the provider's signed source value; the
-- application presents the corresponding allowance as a positive credit.
UPDATE invoice_line_items
SET line_type = CASE
  WHEN description LIKE '%退貨%'
    OR description LIKE '%退費%'
    OR description LIKE '%退款%'
    THEN 'refund'
  ELSE 'allowance'
END
WHERE line_type = 'item'
  AND amount < 0;
