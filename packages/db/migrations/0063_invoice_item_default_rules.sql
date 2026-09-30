-- Classify common invoice item descriptions deterministically before the fallback.
-- These are deliberately broad enough to cover new products, but remain
-- keyword rules so users can inspect and override them without an LLM.
INSERT OR IGNORE INTO classification_rules
  (id, category_id, target_type, field, operator, pattern, priority, enabled, is_system, source, description, created_at, updated_at)
VALUES
  ('system:invoice:food-keywords', 'food', 'invoice_item', 'any_text', 'regex',
   '餐飲|餐廳|美食|食物|食品|食材|料理|飯|麵|肉|雞|豬|牛|魚|蝦|蛋|奶|乳|豆漿|麵包|吐司|咖啡|茶|飲|水|果汁|水果|蔬菜|米酒|醬|調味|火鍋|便當|漢堡|壽司|甜點|蛋糕|餅|零食|沙拉|BBQ|補給|food|drink|restaurant|cafe|coffee|starbucks|mcdonald|ubereats|foodpanda',
   115, 1, 1, 'system', '發票食品、餐飲與飲料品項', '2026-09-29T00:00:00.000Z', '2026-09-29T00:00:00.000Z'),
  ('system:invoice:shopping-keywords', 'shopping', 'invoice_item', 'any_text', 'regex',
   '迪卡儂|decathlon|全聯|全家|便利商店|超商|家樂福|愛買|大潤發|costco|ikea|宜家|momo|pchome|蝦皮|百貨|商場|購物|商品|服飾|衣物|鞋|包|家電|家用品|日用品|清潔|衛生紙|紙巾|dumbbell|strap|shopping|store|market',
   110, 1, 1, 'system', '發票購物、日用品與零售商家', '2026-09-29T00:00:00.000Z', '2026-09-29T00:00:00.000Z'),
  ('system:invoice:housing-keywords', 'housing', 'invoice_item', 'any_text', 'regex',
   '房租|租金|管理費|水費|電費|瓦斯費|天然氣|居住|租屋|物業',
   109, 1, 1, 'system', '發票居住與住宅費用', '2026-09-29T00:00:00.000Z', '2026-09-29T00:00:00.000Z'),
  ('system:invoice:health-keywords', 'health', 'invoice_item', 'any_text', 'regex',
   '藥局|藥品|醫療|診所|醫院|牙醫|保健|維他命|口罩|health|pharmacy|clinic',
   108, 1, 1, 'system', '發票醫療、藥品與保健品', '2026-09-29T00:00:00.000Z', '2026-09-29T00:00:00.000Z'),
  ('system:invoice:entertainment-keywords', 'entertainment', 'invoice_item', 'any_text', 'regex',
   '電影|遊戲|票券|展覽|演唱會|娛樂|steam|netflix|youtube premium|music|cinema|game',
   107, 1, 1, 'system', '發票娛樂與休閒品項', '2026-09-29T00:00:00.000Z', '2026-09-29T00:00:00.000Z'),
  ('system:invoice:education-keywords', 'education', 'invoice_item', 'any_text', 'regex',
   '課程|學費|教育|學校|補習|書籍|文具|書店|course|tuition|school',
   106, 1, 1, 'system', '發票教育、書籍與文具', '2026-09-29T00:00:00.000Z', '2026-09-29T00:00:00.000Z'),
  ('system:invoice:software-keywords', 'software', 'invoice_item', 'any_text', 'regex',
   'openai|chatgpt|cursor|cloudflare|github|notion|dropbox|adobe|microsoft|google cloud|software|subscription',
   105, 1, 1, 'system', '發票軟體與線上服務', '2026-09-29T00:00:00.000Z', '2026-09-29T00:00:00.000Z');
