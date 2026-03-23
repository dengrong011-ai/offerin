-- 独立 JD 库：与简历版本解耦，可选标签便于与简历/计划等自行对应
CREATE TABLE IF NOT EXISTS saved_jds (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  tags TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_saved_jds_user_id ON saved_jds(user_id);
CREATE INDEX IF NOT EXISTS idx_saved_jds_user_updated ON saved_jds(user_id, updated_at DESC);

ALTER TABLE saved_jds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "用户可查看自己的 JD"
  ON saved_jds FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "用户可创建自己的 JD"
  ON saved_jds FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "用户可更新自己的 JD"
  ON saved_jds FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "用户可删除自己的 JD"
  ON saved_jds FOR DELETE
  USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION update_saved_jds_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_saved_jds_updated_at ON saved_jds;
CREATE TRIGGER trigger_update_saved_jds_updated_at
  BEFORE UPDATE ON saved_jds
  FOR EACH ROW
  EXECUTE FUNCTION update_saved_jds_updated_at();
