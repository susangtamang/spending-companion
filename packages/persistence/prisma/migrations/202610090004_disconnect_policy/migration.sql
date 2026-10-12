ALTER TABLE "plaid_items" DROP CONSTRAINT "plaid_items_history_policy";
UPDATE "plaid_items"
SET "disconnect_history_policy" = CASE "disconnect_history_policy"
  WHEN 'retain_history' THEN 'retain'
  WHEN 'delete_history' THEN 'delete'
  ELSE "disconnect_history_policy"
END;
ALTER TABLE "plaid_items" ADD CONSTRAINT "plaid_items_history_policy" CHECK (
  "disconnect_history_policy" IS NULL OR "disconnect_history_policy" IN ('retain', 'delete')
);
