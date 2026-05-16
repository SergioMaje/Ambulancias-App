// supabase/functions/check-expired/index.ts
//
// Fallback servidor para reasignación por timeout.
// Cubre el caso donde el conductor cierra la app antes de los 30s
// y el setTimeout del cliente nunca se dispara.
//
// Configurar como Scheduled Function en:
// Dashboard → Edge Functions → check-expired → Schedule → "* * * * *"

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

Deno.serve(async () => {
  const { data: ids, error } = await supabase.rpc('get_expired_emergency_ids');

  if (error) {
    console.error('[check-expired] get_expired_emergency_ids falló:', error.message);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  if (!ids || ids.length === 0) {
    return new Response(JSON.stringify({ processed: 0 }));
  }

  console.log('[check-expired] emergencias expiradas encontradas:', ids);

  let reassigned = 0;
  for (const id of ids) {
    const { data: nextDriver, error: rpcError } = await supabase.rpc(
      'reassign_emergency', { p_emergency_id: id }
    );
    if (rpcError) {
      console.error(`[check-expired] reassign_emergency(${id}) falló:`, rpcError.message);
    } else {
      console.log(`[check-expired] emergencia ${id} → reasignada a:`, nextDriver ?? 'ninguno disponible');
      reassigned++;
    }
  }

  return new Response(JSON.stringify({ processed: ids.length, reassigned }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
