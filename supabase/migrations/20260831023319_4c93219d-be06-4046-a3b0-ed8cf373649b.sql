ALTER TABLE public.session_exercises
  ADD COLUMN IF NOT EXISTS training_method_id text,
  ADD COLUMN IF NOT EXISTS training_method_config jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.template_exercises
  ADD COLUMN IF NOT EXISTS training_method_id text,
  ADD COLUMN IF NOT EXISTS training_method_config jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS public.training_specialization_windows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  method_id text NOT NULL DEFAULT 'irondesk-black',
  target_region text NOT NULL,
  started_on date NOT NULL DEFAULT current_date,
  ends_on date NOT NULL,
  status text NOT NULL DEFAULT 'active',
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT training_specialization_windows_status_check
    CHECK (status IN ('active', 'suspended', 'completed', 'cancelled'))
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.training_specialization_windows TO authenticated;
GRANT ALL ON public.training_specialization_windows TO service_role;

ALTER TABLE public.training_specialization_windows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Athletes read own specialization windows" ON public.training_specialization_windows;
CREATE POLICY "Athletes read own specialization windows"
  ON public.training_specialization_windows FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Athletes create own specialization windows" ON public.training_specialization_windows;
CREATE POLICY "Athletes create own specialization windows"
  ON public.training_specialization_windows FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Athletes update own specialization windows" ON public.training_specialization_windows;
CREATE POLICY "Athletes update own specialization windows"
  ON public.training_specialization_windows FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Athletes delete own specialization windows" ON public.training_specialization_windows;
CREATE POLICY "Athletes delete own specialization windows"
  ON public.training_specialization_windows FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

DROP TRIGGER IF EXISTS training_specialization_windows_updated_at ON public.training_specialization_windows;
CREATE TRIGGER training_specialization_windows_updated_at
  BEFORE UPDATE ON public.training_specialization_windows
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS training_specialization_windows_user_status_idx
  ON public.training_specialization_windows (user_id, status);
