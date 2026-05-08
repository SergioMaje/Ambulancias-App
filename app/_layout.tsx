// app/_layout.tsx
// Layout raíz: decide a dónde mandar al usuario según su estado de autenticación.
// Flujo:
//   Sin sesión            → (auth)/login
//   Con sesión, sin perfil → (auth)/onboarding
//   Con sesión, con perfil → (app)/

import { Stack, useRouter, useSegments } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import {
  registerForPushNotificationsAsync,
  savePushToken,
} from "../lib/notifications";


export default function RootLayout() {
  const [session, setSession] = useState<Session | null>(null);
  // undefined = todavía cargando | null = no tiene perfil | string = rol del usuario
  const [role, setRole] = useState<string | null | undefined>(undefined);
  const router = useRouter();
  const segments = useSegments();
  // Evita registrar el token más de una vez por sesión
  const pushRegisteredRef = useRef<string | null>(null);

  // Carga el perfil del usuario desde la tabla profiles
  async function cargarPerfil(userId: string) {
    const { data, error } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", userId)
      .single();

    if (error) {
      // PGRST116 = no rows found (usuario sin perfil → onboarding)
      // Cualquier otro error = red/BD → mandamos a null para evitar pantalla en blanco;
      // el onboarding verifica el perfil antes de sobreescribir cualquier rol existente.
      setRole(null);
      return;
    }

    setRole(data?.role ?? null);
  }

  useEffect(() => {
    // Verificamos si hay una sesión guardada al arrancar
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) cargarPerfil(session.user.id);
      else setRole(null);
    });

    // Escuchamos cambios de auth (login, logout, token renovado)
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session) cargarPerfil(session.user.id);
      else setRole(null);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Registra el push token cada vez que cambia el usuario logueado
  useEffect(() => {
    const userId = session?.user.id;
    if (!userId || pushRegisteredRef.current === userId) return;
    pushRegisteredRef.current = userId;

    registerForPushNotificationsAsync()
      .then((token) => {
        if (token) savePushToken(userId, token);
      })
      .catch(() => {
        // No crashear la app si las notificaciones no están disponibles
      });
  }, [session?.user.id]);

  // Redirigimos cada vez que cambia la sesión o el rol
  useEffect(() => {
    if (role === undefined) return;

    const seg0 = segments[0] as string;

    if (!session) {
      // Sin sesión → login (si no está ya en auth)
      if (seg0 !== "(auth)") router.replace("/(auth)/login" as any);
      return;
    }

    if (!role) {
      // Con sesión pero sin perfil → onboarding
      router.replace("/(auth)/onboarding" as any);
      return;
    }

    // Con sesión y rol → verificar que está en la pantalla correcta
    const enDestino =
      (role === "conductor" && seg0 === "conductor") ||
      (role !== "conductor" && seg0 === "civil");

    if (!enDestino) {
      if (role === "conductor") router.replace("/conductor/" as any);
      else router.replace("/civil/" as any);
    }
  }, [session, role]);

  // Mientras verificamos, no renderizamos nada (evita flash de pantalla incorrecta)
  if (role === undefined) return null;

  return <Stack screenOptions={{ headerShown: false }} />;
}
