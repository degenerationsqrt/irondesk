-- Connections & Imports foundation

CREATE TABLE public.data_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_type text NOT NULL CHECK (source_type IN ('health_connect','garmin_file','generic_file')),
  label text NOT NULL,
  status text NOT NULL DEFAULT 'idle' CHECK (status IN ('idle','connected','error')),
  last_import_at timestamptz,
  retain_original_files boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, source_type, label)
);

CREATE TABLE public.import_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  data_source_id uuid REFERENCES public.data_sources(id) ON DELETE SET NULL,
  source_type text NOT NULL CHECK (source_type IN ('health_connect','garmin_file','generic_file')),
  file_name text,
  file_size_bytes bigint,
  file_format text NOT NULL CHECK (file_format IN ('fit','tcx','gpx','csv','json','zip')),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','committing','completed','partial','failed','rolled_back')),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  total_records integer NOT NULL DEFAULT 0,
  imported_count integer NOT NULL DEFAULT 0,
  duplicate_count integer NOT NULL DEFAULT 0,
  warning_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  error_message text,
  storage_path text,
  normalized_version smallint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.imported_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  import_job_id uuid REFERENCES public.import_jobs(id) ON DELETE CASCADE,
  source_type text NOT NULL,
  source_file_name text,
  external_id text,
  dedupe_hash text NOT NULL,
  activity_type text NOT NULL,
  name text,
  started_at timestamptz NOT NULL,
  source_timezone text,
  duration_sec integer CHECK (duration_sec IS NULL OR duration_sec >= 0),
  distance_m numeric CHECK (distance_m IS NULL OR distance_m >= 0),
  calories integer CHECK (calories IS NULL OR calories >= 0),
  avg_hr smallint CHECK (avg_hr IS NULL OR (avg_hr > 0 AND avg_hr < 300)),
  max_hr smallint CHECK (max_hr IS NULL OR (max_hr > 0 AND max_hr < 300)),
  elevation_gain_m numeric,
  steps integer CHECK (steps IS NULL OR steps >= 0),
  notes text,
  raw_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  normalized_version smallint NOT NULL DEFAULT 1,
  imported_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, dedupe_hash)
);

CREATE TABLE public.health_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  import_job_id uuid REFERENCES public.import_jobs(id) ON DELETE CASCADE,
  source_type text NOT NULL,
  source_file_name text,
  external_id text,
  dedupe_hash text NOT NULL,
  metric_type text NOT NULL CHECK (metric_type IN (
    'steps','sleep_minutes','sleep_efficiency_percent','resting_hr','hrv_ms',
    'bodyweight_kg','active_calories','distance_m','heart_rate_bpm'
  )),
  recorded_at timestamptz NOT NULL,
  source_timezone text,
  value numeric NOT NULL,
  unit text NOT NULL,
  notes text,
  raw_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  normalized_version smallint NOT NULL DEFAULT 1,
  imported_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, dedupe_hash)
);

CREATE TABLE public.saved_import_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_label text NOT NULL,
  file_format text NOT NULL CHECK (file_format IN ('csv','json')),
  record_kind text NOT NULL CHECK (record_kind IN ('activity','metric')),
  mapping jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, source_label, file_format)
);

CREATE INDEX idx_data_sources_user ON public.data_sources (user_id, source_type);
CREATE INDEX idx_import_jobs_user_started ON public.import_jobs (user_id, started_at DESC);
CREATE INDEX idx_import_jobs_source ON public.import_jobs (data_source_id);
CREATE INDEX idx_imported_activities_user_started ON public.imported_activities (user_id, started_at DESC);
CREATE INDEX idx_imported_activities_job ON public.imported_activities (import_job_id);
CREATE INDEX idx_imported_activities_external ON public.imported_activities (user_id, source_type, external_id);
CREATE INDEX idx_health_metrics_user_type_time ON public.health_metrics (user_id, metric_type, recorded_at DESC);
CREATE INDEX idx_health_metrics_job ON public.health_metrics (import_job_id);
CREATE INDEX idx_saved_mappings_user ON public.saved_import_mappings (user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.data_sources TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.import_jobs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.imported_activities TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.health_metrics TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.saved_import_mappings TO authenticated;
GRANT ALL ON public.data_sources TO service_role;
GRANT ALL ON public.import_jobs TO service_role;
GRANT ALL ON public.imported_activities TO service_role;
GRANT ALL ON public.health_metrics TO service_role;
GRANT ALL ON public.saved_import_mappings TO service_role;

ALTER TABLE public.data_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.import_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.imported_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.health_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saved_import_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own data sources read" ON public.data_sources FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own data sources write" ON public.data_sources FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own data sources update" ON public.data_sources FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own data sources delete" ON public.data_sources FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "own import jobs read" ON public.import_jobs FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own import jobs write" ON public.import_jobs FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own import jobs update" ON public.import_jobs FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own import jobs delete" ON public.import_jobs FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "own activities read" ON public.imported_activities FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own activities write" ON public.imported_activities FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own activities update" ON public.imported_activities FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own activities delete" ON public.imported_activities FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "own metrics read" ON public.health_metrics FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own metrics write" ON public.health_metrics FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own metrics update" ON public.health_metrics FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own metrics delete" ON public.health_metrics FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "own mappings read" ON public.saved_import_mappings FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own mappings write" ON public.saved_import_mappings FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own mappings update" ON public.saved_import_mappings FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own mappings delete" ON public.saved_import_mappings FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER data_sources_updated_at BEFORE UPDATE ON public.data_sources FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER import_jobs_updated_at BEFORE UPDATE ON public.import_jobs FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER imported_activities_updated_at BEFORE UPDATE ON public.imported_activities FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER health_metrics_updated_at BEFORE UPDATE ON public.health_metrics FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER saved_import_mappings_updated_at BEFORE UPDATE ON public.saved_import_mappings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();