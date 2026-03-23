-- 全局笔记本：笔记可不绑定单条计划，通过 linked_plan_ids 关联 0..n 条 saved_career_plans
-- 历史数据：将原 plan_id 写入 linked_plan_ids 后 plan_id 置空（单一事实来源为 linked_plan_ids）

ALTER TABLE plan_notes ADD COLUMN IF NOT EXISTS linked_plan_ids UUID[] DEFAULT '{}';

UPDATE plan_notes
SET linked_plan_ids = ARRAY[plan_id]
WHERE plan_id IS NOT NULL
  AND (linked_plan_ids IS NULL OR linked_plan_ids = '{}');

ALTER TABLE plan_notes ALTER COLUMN plan_id DROP NOT NULL;

UPDATE plan_notes SET plan_id = NULL WHERE plan_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_plan_notes_linked_plan_ids ON plan_notes USING GIN (linked_plan_ids);
CREATE INDEX IF NOT EXISTS idx_plan_notes_user_created ON plan_notes (user_id, created_at DESC);
