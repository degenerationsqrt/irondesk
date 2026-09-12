-- A row's user_id does not establish ownership of its foreign-key parents.
-- These restrictive checks supplement the existing owner policies: clients
-- may link only their own parents, while null links and service-role ingestion
-- retain their existing behaviour. Existing rows are not rewritten or hidden.

CREATE POLICY import_jobs_parent_insert ON public.import_jobs
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (
    data_source_id IS NULL OR EXISTS (
      SELECT 1 FROM public.data_sources AS parent
      WHERE parent.id = import_jobs.data_source_id AND parent.user_id = (SELECT auth.uid())
    )
  );
CREATE POLICY import_jobs_parent_update ON public.import_jobs
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (
    data_source_id IS NULL OR EXISTS (
      SELECT 1 FROM public.data_sources AS parent
      WHERE parent.id = import_jobs.data_source_id AND parent.user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY imported_activities_parent_insert ON public.imported_activities
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (
    import_job_id IS NULL OR EXISTS (
      SELECT 1 FROM public.import_jobs AS parent
      WHERE parent.id = imported_activities.import_job_id AND parent.user_id = (SELECT auth.uid())
    )
  );
CREATE POLICY imported_activities_parent_update ON public.imported_activities
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (
    import_job_id IS NULL OR EXISTS (
      SELECT 1 FROM public.import_jobs AS parent
      WHERE parent.id = imported_activities.import_job_id AND parent.user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY health_metrics_parent_insert ON public.health_metrics
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (
    import_job_id IS NULL OR EXISTS (
      SELECT 1 FROM public.import_jobs AS parent
      WHERE parent.id = health_metrics.import_job_id AND parent.user_id = (SELECT auth.uid())
    )
  );
CREATE POLICY health_metrics_parent_update ON public.health_metrics
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (
    import_job_id IS NULL OR EXISTS (
      SELECT 1 FROM public.import_jobs AS parent
      WHERE parent.id = health_metrics.import_job_id AND parent.user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY cardio_sessions_parent_insert ON public.cardio_sessions
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (
    session_id IS NULL OR EXISTS (
      SELECT 1 FROM public.workout_sessions AS parent
      WHERE parent.id = cardio_sessions.session_id AND parent.user_id = (SELECT auth.uid())
    )
  );
CREATE POLICY cardio_sessions_parent_update ON public.cardio_sessions
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (
    session_id IS NULL OR EXISTS (
      SELECT 1 FROM public.workout_sessions AS parent
      WHERE parent.id = cardio_sessions.session_id AND parent.user_id = (SELECT auth.uid())
    )
  );
