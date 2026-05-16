-- supabase/migrations/dispatcher.sql
-- Despacho inteligente: asignar conductor más cercano con fallback por timeout
--
-- 1. Columnas nuevas en emergencies
-- 2. Trigger BEFORE INSERT para asignar el conductor más cercano
-- 3. Función RPC reassign_emergency (llamada por el conductor al ignorar o por cron)
-- 4. pg_cron: reasignar cada minuto las emergencias cuyo timeout expiró

-- ── 1. Columnas ────────────────────────────────────────────────────────────────

ALTER TABLE emergencies
  ADD COLUMN IF NOT EXISTS assigned_driver_id    uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS tried_driver_ids       uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS assignment_expires_at  timestamptz;

-- ── 2. Trigger: asignar conductor más cercano en el INSERT ────────────────────

CREATE OR REPLACE FUNCTION fn_assign_nearest_driver()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_driver_id uuid;
BEGIN
  SELECT l.driver_id
  INTO   v_driver_id
  FROM   locations l
  JOIN   ambulances a ON a.driver_id = l.driver_id
  WHERE  a.active = true
    AND  l.position IS NOT NULL
  ORDER BY ST_Distance(
    l.position::geography,
    ST_SetSRID(ST_MakePoint(NEW.longitude, NEW.latitude), 4326)::geography
  )
  LIMIT 1;

  IF v_driver_id IS NOT NULL THEN
    NEW.assigned_driver_id    := v_driver_id;
    NEW.tried_driver_ids      := ARRAY[v_driver_id];
    NEW.assignment_expires_at := now() + interval '30 seconds';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assign_driver ON emergencies;
CREATE TRIGGER trg_assign_driver
  BEFORE INSERT ON emergencies
  FOR EACH ROW
  EXECUTE FUNCTION fn_assign_nearest_driver();

-- ── 3. RPC pública: reasignar al siguiente conductor ─────────────────────────
-- Llamada por el conductor al ignorar la alerta, o por el cron al expirar.

CREATE OR REPLACE FUNCTION reassign_emergency(p_emergency_id bigint)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_em        record;
  v_driver_id uuid;
BEGIN
  SELECT *
  INTO   v_em
  FROM   emergencies
  WHERE  id     = p_emergency_id
    AND  status = 'pending'
  FOR UPDATE SKIP LOCKED;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- Siguiente conductor activo con posición, no intentado aún
  SELECT l.driver_id
  INTO   v_driver_id
  FROM   locations l
  JOIN   ambulances a ON a.driver_id = l.driver_id
  WHERE  a.active = true
    AND  l.position IS NOT NULL
    AND  NOT (l.driver_id = ANY(v_em.tried_driver_ids))
  ORDER BY ST_Distance(
    l.position::geography,
    ST_SetSRID(ST_MakePoint(v_em.longitude, v_em.latitude), 4326)::geography
  )
  LIMIT 1;

  UPDATE emergencies SET
    assigned_driver_id    = v_driver_id,
    tried_driver_ids      = CASE
                              WHEN v_driver_id IS NOT NULL
                              THEN array_append(tried_driver_ids, v_driver_id)
                              ELSE tried_driver_ids
                            END,
    assignment_expires_at = CASE
                              WHEN v_driver_id IS NOT NULL
                              THEN now() + interval '30 seconds'
                              ELSE NULL
                            END
  WHERE id = p_emergency_id;

  RETURN v_driver_id;
END;
$$;

GRANT EXECUTE ON FUNCTION reassign_emergency(bigint) TO authenticated;

-- Replica Identity FULL: necesario para que Realtime filtre UPDATE por assigned_driver_id
ALTER TABLE emergencies REPLICA IDENTITY FULL;

-- RLS: conductor puede ver emergencias donde es el asignado (Realtime lo requiere)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'emergencies'
      AND policyname = 'conductor can read assigned emergencies'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY "conductor can read assigned emergencies"
        ON emergencies FOR SELECT
        USING (assigned_driver_id = auth.uid());
    $policy$;
  END IF;
END;
$$;

-- ── 4. pg_cron: reasignaciones automáticas por timeout ───────────────────────
-- Requiere la extensión pg_cron (disponible en Supabase Pro).
-- Activar desde: Dashboard → Database → Extensions → pg_cron
-- Si no está disponible, el fallback es el timer de 2 min del cliente.

SELECT cron.schedule(
  'reassign-expired-emergencies',
  '* * * * *',
  $$
    SELECT reassign_emergency(id)
    FROM   emergencies
    WHERE  status                = 'pending'
      AND  assignment_expires_at IS NOT NULL
      AND  assignment_expires_at  < now();
  $$
);
