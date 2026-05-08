// supabase/functions/send-push/index.ts
//
// Edge Function invocada por un Database Webhook sobre la tabla "emergencies".
//
// Eventos:
//   INSERT (status = pending)          → notifica al conductor más cercano
//   UPDATE (pending → accepted)        → notifica al civil (ambulancia en camino)
//   UPDATE (accepted → in_transit)     → notifica al civil (paciente recogido)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

Deno.serve(async (req) => {
  const { type, record, old_record } = await req.json();
  const messages: object[] = [];

  // ── Nueva emergencia → conductor más cercano ──────────────────────
  if (type === 'INSERT' && record.status === 'pending') {
    const { data: nearest, error: rpcError } = await supabase.rpc(
      'get_nearest_active_driver',
      { p_lat: record.latitude, p_lng: record.longitude, p_limit: 3 }
    );

    if (rpcError) {
      console.error('[send-push] nearest driver RPC failed:', rpcError.message);
      return new Response(JSON.stringify({ error: rpcError.message }), { status: 500 });
    }

    if (nearest?.length) {
      const primaryDriver = nearest[0];
      const driverIds = [primaryDriver.driver_id];

      const { data: profiles } = await supabase
        .from('profiles')
        .select('expo_push_token')
        .in('id', driverIds)
        .not('expo_push_token', 'is', null);

      for (const p of profiles ?? []) {
        messages.push({
          to: p.expo_push_token,
          channelId: 'emergencia',
          title: '🚨 Nueva alerta SOS',
          body: `Paciente a ${Math.round(primaryDriver.distance_m)}m de distancia`,
          data: { emergencyId: record.id, latitude: record.latitude, longitude: record.longitude },
          priority: 'high',
          sound: 'default',
        });
      }
    }
  }

  // ── Alerta aceptada → avisar al civil ────────────────────────────
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

  // ── Paciente recogido → avisar al civil ──────────────────────────
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
