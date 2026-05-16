-- supabase/migrations/fix_conductor_role_filter.sql
--
-- Corrige el bug donde civiles con GPS en `locations` eran tratados como conductores.
-- Añade JOIN con profiles WHERE role='conductor' en el trigger de asignación y en reassign_emergency.

-- ── Trigger: asignar conductor más cercano (solo role='conductor') ──────────────

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
  JOIN   profiles   p ON p.id        = l.driver_id
  WHERE  a.active        = true
    AND  p.role          = 'conductor'
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

-- ── RPC: reasignar al siguiente conductor (solo role='conductor') ──────────────

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

  -- Siguiente conductor activo con posición, no intentado aún, con role='conductor'
  SELECT l.driver_id
  INTO   v_driver_id
  FROM   locations l
  JOIN   ambulances a ON a.driver_id = l.driver_id
  JOIN   profiles   p ON p.id        = l.driver_id
  WHERE  a.active        = true
    AND  p.role          = 'conductor'
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
                              ELSE '{}'   -- resetear para poder ciclar de nuevo
                            END,
    assignment_expires_at = now() + interval '30 seconds'
  WHERE id = p_emergency_id;

  RETURN v_driver_id;
END;
$$;

GRANT EXECUTE ON FUNCTION reassign_emergency(bigint) TO authenticated;
