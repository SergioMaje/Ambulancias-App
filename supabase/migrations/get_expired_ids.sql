-- supabase/migrations/get_expired_ids.sql
-- RPC auxiliar usada por la Edge Function check-expired para obtener
-- las IDs de emergencias cuya asignación ya expiró.

CREATE OR REPLACE FUNCTION get_expired_emergency_ids()
RETURNS SETOF bigint
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT id
  FROM   emergencies
  WHERE  status                = 'pending'
    AND  assignment_expires_at IS NOT NULL
    AND  assignment_expires_at  < now();
$$;

GRANT EXECUTE ON FUNCTION get_expired_emergency_ids() TO service_role;
