// lib/supabase.js
// POR AHORA: archivo preparado pero sin credenciales reales.
// Cuando Román cree el proyecto en Supabase, reemplaza estos dos valores.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";

// Estos valores vienen del dashboard de Supabase:
// Project Settings > API > Project URL y anon/public key
export const SUPABASE_URL = "https://mzxxdeglootkxmzblilm.supabase.co";
export const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im16eHhkZWdsb290a3htemJsaWxtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ0Nzk3NzUsImV4cCI6MjA5MDA1NTc3NX0.8AkxYjY1TxYndrwUhjQbUuDgrkXFll6XCmptCj1PCwM";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
