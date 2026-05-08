-- supabase/migrations/push_notifications.sql
-- Sprint 3: Soporte para Expo Push Notifications
--
-- 1. Añade la columna expo_push_token a la tabla profiles
-- 2. Crea el Database Webhook que dispara la Edge Function send-push

-- ── 1. Columna para guardar el token del dispositivo ────────────────
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS expo_push_token text;

-- ── 2. Política RLS: cada usuario puede actualizar su propio token ───
-- Sin esto, el UPDATE desde el cliente falla con "permission denied"
-- si la tabla profiles tiene RLS activo.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'profiles'
      AND policyname = 'users can update own push token'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY "users can update own push token"
        ON profiles
        FOR UPDATE
        USING (auth.uid() = id)
        WITH CHECK (auth.uid() = id);
    $policy$;
  END IF;
END;
$$;

-- ── 2. Database Webhook ─────────────────────────────────────────────
-- Crea esto desde el Dashboard de Supabase:
--   Database → Webhooks → Create a new hook
--
--   Name:        send_push_on_alerta
--   Table:       emergencia
--   Events:      INSERT, UPDATE
--   Type:        Supabase Edge Functions
--   Edge Function: send-push
--
-- O si prefieres hacerlo por SQL (requiere activar pg_net):
--
-- SELECT supabase_functions.http_request(
--   'https://<PROJECT_REF>.supabase.co/functions/v1/send-push',
--   'POST',
--   '{"Content-Type":"application/json","Authorization":"Bearer <ANON_KEY>"}',
--   '{}',
--   '5000'
-- );
--
-- Lo más sencillo es hacerlo desde el Dashboard — no requiere configuración extra.
