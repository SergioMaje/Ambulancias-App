-- supabase/migrations/dispatch_log.sql
-- Auditoría completa del flujo de despacho de alertas.
-- Registra automáticamente cada asignación, reasignación y aceptación.

-- ── 1. Tabla de auditoría ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS dispatch_log (
  id            bigserial    PRIMARY KEY,
  emergency_id  bigint       NOT NULL REFERENCES emergencies(id),
  driver_id     uuid,
  action        text         NOT NULL,
  -- 'assigned'        → primer conductor asignado al crear la emergencia
  -- 'reassigned'      → conductor ignoró o expiró, se asigna el siguiente
  -- 'accepted'        → conductor aceptó la emergencia
  -- 'no_drivers'      → reasignación intentada pero no hay más conductores disponibles
  tried_count   int,
  created_at    timestamptz  DEFAULT now()
);

-- RLS: nadie puede leer ni escribir desde el cliente (solo service_role y funciones SECURITY DEFINER)
ALTER TABLE dispatch_log ENABLE ROW LEVEL SECURITY;

-- ── 2. Trigger: registrar cada cambio relevante en emergencies ────────────────

CREATE OR REPLACE FUNCTION fn_log_dispatch_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Primera asignación (INSERT con conductor asignado)
  IF TG_OP = 'INSERT' AND NEW.assigned_driver_id IS NOT NULL THEN
    INSERT INTO dispatch_log (emergency_id, driver_id, action, tried_count)
    VALUES (NEW.id, NEW.assigned_driver_id, 'assigned', array_length(NEW.tried_driver_ids, 1));
    RETURN NEW;
  END IF;

  -- Reasignación: assigned_driver_id cambió y sigue pending
  IF TG_OP = 'UPDATE' AND NEW.status = 'pending'
     AND (OLD.assigned_driver_id IS DISTINCT FROM NEW.assigned_driver_id)
  THEN
    IF NEW.assigned_driver_id IS NULL THEN
      INSERT INTO dispatch_log (emergency_id, driver_id, action, tried_count)
      VALUES (NEW.id, NULL, 'no_drivers', array_length(NEW.tried_driver_ids, 1));
    ELSE
      INSERT INTO dispatch_log (emergency_id, driver_id, action, tried_count)
      VALUES (NEW.id, NEW.assigned_driver_id, 'reassigned', array_length(NEW.tried_driver_ids, 1));
    END IF;
    RETURN NEW;
  END IF;

  -- Aceptación: pending → accepted
  IF TG_OP = 'UPDATE' AND OLD.status = 'pending' AND NEW.status = 'accepted' THEN
    INSERT INTO dispatch_log (emergency_id, driver_id, action, tried_count)
    VALUES (NEW.id, NEW.driver_id, 'accepted', array_length(NEW.tried_driver_ids, 1));
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_dispatch ON emergencies;
CREATE TRIGGER trg_log_dispatch
  AFTER INSERT OR UPDATE ON emergencies
  FOR EACH ROW
  EXECUTE FUNCTION fn_log_dispatch_change();
