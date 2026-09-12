-- Device event receipts: make access explicit instead of implicit fail-closed.
-- Owners may read their own watch-event receipts; all writes stay server-side only.
GRANT SELECT ON public.connect_iq_event_receipts TO authenticated;
GRANT ALL ON public.connect_iq_event_receipts TO service_role;
REVOKE ALL ON public.connect_iq_event_receipts FROM anon;

ALTER TABLE public.connect_iq_event_receipts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS connect_iq_event_receipts_select_own ON public.connect_iq_event_receipts;
CREATE POLICY connect_iq_event_receipts_select_own
  ON public.connect_iq_event_receipts
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());
