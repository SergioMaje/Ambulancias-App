// app/(auth)/onboarding.jsx
// Pantalla de transición post-registro: crea el perfil del usuario como 'civil'
// automáticamente. El personal médico nunca llega aquí porque el admin ya les
// crea el perfil con role='conductor' desde Supabase.
import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { supabase } from "../../lib/supabase";

export default function OnboardingScreen() {
  const [error, setError] = useState(null);
  const router = useRouter();

  useEffect(() => {
    crearPerfil();
  }, []);

  async function crearPerfil() {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setError("No se encontró el usuario. Intenta iniciar sesión de nuevo.");
      return;
    }

    const { data: perfilExistente } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (perfilExistente?.role === "conductor") {
      router.replace("/conductor/");
      return;
    }

    if (perfilExistente?.role === "civil") {
      // Ya tiene perfil civil (p.ej. doble ejecución)
      await supabase.auth.refreshSession();
      return;
    }

    // Sin perfil → crear como civil
    const { error } = await supabase.from("profiles").upsert({
      id: user.id,
      role: "civil",
      full_name: user.user_metadata?.full_name ?? null,
    });

    if (error) {
      setError("No se pudo crear tu perfil. Intenta de nuevo.\n\n" + error.message);
      return;
    }

    await supabase.auth.refreshSession();
  }

  if (error) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorTexto}>{error}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color="#d32f2f" />
      <Text style={styles.texto}>Configurando tu cuenta…</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f5f5f5",
    justifyContent: "center",
    alignItems: "center",
    gap: 16,
    paddingHorizontal: 24,
  },
  texto: {
    fontSize: 15,
    color: "#666",
  },
  errorTexto: {
    fontSize: 14,
    color: "#d32f2f",
    textAlign: "center",
    lineHeight: 20,
  },
});
