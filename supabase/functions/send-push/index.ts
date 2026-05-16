// supabase/functions/send-push/index.ts
//
// Edge Function invocada por un Database Webhook sobre la tabla "emergencies".
//
// Eventos:
//   INSERT (status = pending)                        → push al conductor asignado
//   UPDATE (assigned_driver_id cambia, pending)      → push al nuevo conductor asignado (reasignación)
//   UPDATE (pending → accepted)                      → push al civil (ambulancia en camino)
//   UPDATE (accepted → in_transit)                   → push al civil (paciente recogido)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

async function pushToDriver(driverId: string, emergencyId: string, lat: number, lng: number) {
  const { data: profile } = await supabase
    .from('profiles')
    .select('expo_push_token')
    .eq('id', driverId)
    .single();

  if (!profile?.expo_push_token) return null;

  return {
    to: profile.expo_push_token,
    channelId: 'emergencia',
    title: '🚨 Nueva alerta SOS',
    body: 'Paciente cercano necesita asistencia urgente',
    data: { emergencyId, latitude: lat, longitude: lng },
    priority: 'high',
    sound: 'default',
  };
}

Deno.serve(async (req) => {
  const { type, record, old_record } = await req.json();
  const messages: object[] = [];

  // ── Nueva emergencia → conductor asignado por trigger ─────────────────────
  if (type === 'INSERT' && record.status === 'pending' && record.assigned_driver_id) {
    const msg = await pushToDriver(
      record.assigned_driver_id,
      record.id,
      record.latitude,
      record.longitude,
    );
    if (msg) messages.push(msg);
  }

  // ── Reasignación → avisar al nuevo conductor ──────────────────────────────
  // old_record.assigned_driver_id debe ser non-null para confirmar que
  // hubo un conductor anterior (evita push duplicado si old_record llega incompleto).
  if (
    type === 'UPDATE' &&
    record.status === 'pending' &&
    record.assigned_driver_id != null &&
    old_record?.assigned_driver_id != null &&
    record.assigned_driver_id !== old_record.assigned_driver_id
  ) {
    console.log('[send-push] reasignación → nuevo conductor:', record.assigned_driver_id,
      '| anterior:', old_record?.assigned_driver_id ?? 'ninguno', '| emergencia:', record.id);
    const msg = await pushToDriver(
      record.assigned_driver_id,
      record.id,
      record.latitude,
      record.longitude,
    );
    if (msg) messages.push(msg);
  }

  // ── Alerta aceptada → avisar al civil ─────────────────────────────────────
  if (type === 'UPDATE' && record.status === 'accepted' && old_record?.status === 'pending') {
    const { data: profile } = await supabase
      .from('profiles')
      .select('expo_push_token')
      .eq('id', record.user_id)
      .single();

    if (profile?.expo_push_token) {
      messages.push({
        to: profile.expo_push_token,
        channelId: 'alertas',
        title: '✅ ¡Ambulancia en camino!',
        body: 'Un conductor ha aceptado tu solicitud de ayuda.',
        data: { emergencyId: record.id },
        priority: 'high',
        sound: 'default',
      });
    }
  }

  // ── Paciente recogido → avisar al civil ───────────────────────────────────
  if (type === 'UPDATE' && record.status === 'in_transit' && old_record?.status === 'accepted') {
    const { data: profile } = await supabase
      .from('profiles')
      .select('expo_push_token')
      .eq('id', record.user_id)
      .single();

    if (profile?.expo_push_token) {
      messages.push({
        to: profile.expo_push_token,
        channelId: 'alertas',
        title: '🚑 Paciente recogido',
        body: 'El conductor ha confirmado la recogida y se dirige al hospital.',
        data: { emergencyId: record.id },
        priority: 'high',
        sound: 'default',
      });
    }
  }

  if (messages.length > 0) {
    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'Accept-Encoding': 'gzip, deflate',
      },
      body: JSON.stringify(messages),
    });
    const pushResult = await response.json();
    console.log('[send-push] Expo response:', JSON.stringify(pushResult));
  }

  return new Response(JSON.stringify({ sent: messages.length }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
