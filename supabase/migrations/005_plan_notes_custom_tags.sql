-- 支持用户自定义标签
ALTER TABLE plan_notes ADD COLUMN IF NOT EXISTS linked_custom_tags TEXT[] DEFAULT '{}';
