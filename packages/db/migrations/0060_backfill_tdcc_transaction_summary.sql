-- Keep the provider's transaction type visible after the normalized memo is
-- copied into bank_transactions. Existing TDCC rows can be repaired from the
-- durable bank-page payload when that payload is still available.
WITH tdcc_details AS (
  SELECT
    'tdcc:settlement:' || json_extract(item.task_json, '$.bankId') || ':' ||
      json_extract(item.task_json, '$.accountNo') || ':' ||
      json_extract(item.task_json, '$.currency') AS account_id,
    substr(json_extract(detail.value, '$.txnDateTime'), 1, 4) || '-' ||
      substr(json_extract(detail.value, '$.txnDateTime'), 5, 2) || '-' ||
      substr(json_extract(detail.value, '$.txnDateTime'), 7, 2) || 'T' ||
      substr(json_extract(detail.value, '$.txnDateTime'), 9, 2) || ':' ||
      substr(json_extract(detail.value, '$.txnDateTime'), 11, 2) || ':' ||
      substr(json_extract(detail.value, '$.txnDateTime'), 13, 2) AS posted_date,
    CAST(json_extract(detail.value, '$.transferInAmount') AS INTEGER) -
      CAST(json_extract(detail.value, '$.transferOutAmount') AS INTEGER) AS amount,
    json_extract(detail.value, '$.memo') AS description,
    json_extract(detail.value, '$.summary') AS summary
  FROM tdcc_sync_run_items item, json_each(item.payload_json, '$.details') detail
  WHERE item.task_type = 'bank_page'
    AND json_extract(detail.value, '$.summary') IS NOT NULL
    AND json_extract(detail.value, '$.summary') <> ''
)
UPDATE bank_transactions
SET raw_payload = json_set(
  CASE
    WHEN json_valid(raw_payload) AND json_type(raw_payload) = 'object'
      THEN raw_payload
    ELSE '{}'
  END,
  '$.summary', (
    SELECT tdcc_details.summary
    FROM tdcc_details
    WHERE tdcc_details.account_id = bank_transactions.account_id
      AND tdcc_details.posted_date = bank_transactions.posted_date
      AND tdcc_details.amount = bank_transactions.amount
      AND tdcc_details.description = bank_transactions.description
    LIMIT 1
  )
)
WHERE connector_id = 'tdcc'
  AND EXISTS (
    SELECT 1
    FROM tdcc_details
    WHERE tdcc_details.account_id = bank_transactions.account_id
      AND tdcc_details.posted_date = bank_transactions.posted_date
      AND tdcc_details.amount = bank_transactions.amount
      AND tdcc_details.description = bank_transactions.description
  );
