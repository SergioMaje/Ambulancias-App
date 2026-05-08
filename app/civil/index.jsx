import * as Location from "expo-location";
import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Animated,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { supabase } from "../../lib/supabase";

const DURACION_SOS = 3000;

export default function CivilHomeScreen() {
  // idle | esperando | aceptada | en_camino | completada
  const [estado, setEstado] = useState("idle");

  const [userId, setUserId] = useState(null);
  const [ubicacion, setUbicacion] = useState(null);
  const [alertaId, setAlertaId] = useState(null);
  const [presionando, setPresionando] = useState(false);

  const progreso = useRef(new Animated.Value(0)).current;
  const animRef = useRef(null);
  const presionandoRef = useRef(false);
  const channelRef = useRef(null);
  const router = useRouter();

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) setUserId(user.id);
    });
    obtenerUbicacion();
    return () => channelRef.current?.unsubscribe();
  }, []);

  async function obtenerUbicacion() {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") return;
    const loc = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
    });
    setUbicacion({ lat: loc.coords.latitude, lng: loc.coords.longitude });
  }

  // ── Lógica del botón SOS ─────────────────────────────────────────

  function onPressIn() {
    if (estado !== "idle") return;
    presionandoRef.current = true;
    setPresionando(true);
    progreso.setValue(0);

    animRef.current = Animated.timing(progreso, {
      toValue: 1,
      duration: DURACION_SOS,
      useNativeDriver: false,
    });
    animRef.current.start(({ finished }) => {
      presionandoRef.current = false;
      setPresionando(false);
      if (finished) enviarSOS();
    });
  }

  function onPressOut() {
    if (!presionandoRef.current) return;
    presionandoRef.current = false;
    setPresionando(false);
    animRef.current?.stop();
    Animated.timing(progreso, {
      toValue: 0,
      duration: 150,
      useNativeDriver: false,
    }).start();
  }

  async function enviarSOS() {
    if (!ubicacion || !userId) {
      Alert.alert(
        "Sin ubicación",
        "No se pudo obtener tu posición GPS. Activa el GPS e inténtalo de nuevo."
      );
      progreso.setValue(0);
      return;
    }

    setEstado("esperando");

    const { error: insertError } = await supabase.from("emergencies").insert({
      user_id: userId,
      latitude: ubicacion.lat,
      longitude: ubicacion.lng,
      // PostGIS: POINT(longitud latitud)
      patient_location: `POINT(${ubicacion.lng} ${ubicacion.lat})`,
      status: "pending",
    });

    if (insertError) {
      setEstado("idle");
      progreso.setValue(0);
      Alert.alert("Error", insertError.message ?? "No se pudo enviar la alerta.");
      return;
    }

    const { data, error: selectError } = await supabase
      .from("emergencies")
      .select("id")
      .eq("user_id", userId)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (selectError || !data) {
      setEstado("idle");
      progreso.setValue(0);
      Alert.alert("Error", selectError?.message ?? "No se pudo obtener la alerta.");
      return;
    }

    setAlertaId(data.id);
    suscribirseAlerta(data.id);
  }

  function suscribirseAlerta(id) {
    channelRef.current = supabase
      .channel(`civil-alerta-${id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "emergencies",
          filter: `id=eq.${id}`,
        },
        ({ new: alerta }) => {
          if (alerta.status === "accepted") setEstado("aceptada");
          if (alerta.status === "in_transit") setEstado("en_camino");
          if (alerta.status === "done") setEstado("completada");
          if (alerta.status === "cancelled") {
            setEstado("idle");
            setAlertaId(null);
            progreso.setValue(0);
          }
        }
      )
      .subscribe();
  }

  async function cancelarAlerta() {
    if (alertaId) {
      await supabase
        .from("emergencies")
        .update({ status: "cancelled" })
        .eq("id", alertaId);
    }
    channelRef.current?.unsubscribe();
    setEstado("idle");
    setAlertaId(null);
    progreso.setValue(0);
  }

  function resetear() {
    channelRef.current?.unsubscribe();
    setEstado("idle");
    setAlertaId(null);
    progreso.setValue(0);
  }

  // ── Vistas por estado ────────────────────────────────────────────

  if (estado === "esperando") {
    return (
      <SafeAreaView style={[styles.contenedor, { backgroundColor: "#fff3e0" }]}>
        <Text style={styles.iconoGrande}>🚑</Text>
        <Text style={styles.tituloEstado}>Alerta enviada</Text>
        <Text style={styles.subtituloEstado}>
          Buscando conductor disponible...{"\n"}Mantente en tu ubicación actual.
        </Text>
        <TouchableOpacity style={styles.botonSecundario} onPress={cancelarAlerta}>
          <Text style={styles.botonSecundarioTexto}>Cancelar alerta</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  if (estado === "aceptada") {
    return (
      <SafeAreaView style={[styles.contenedor, { backgroundColor: "#e8f5e9" }]}>
        <Text style={styles.iconoGrande}>✅</Text>
        <Text style={styles.tituloEstado}>¡Ambulancia en camino!</Text>
        <Text style={styles.subtituloEstado}>
          Un conductor ha aceptado tu solicitud.{"\n"}Quédate donde estás.
        </Text>
      </SafeAreaView>
    );
  }

  if (estado === "en_camino") {
    return (
      <SafeAreaView style={[styles.contenedor, { backgroundColor: "#fff8e1" }]}>
        <Text style={styles.iconoGrande}>🚑</Text>
        <Text style={styles.tituloEstado}>Paciente recogido</Text>
        <Text style={styles.subtituloEstado}>
          El conductor te ha recogido{"\n"}y se dirige al hospital.
        </Text>
      </SafeAreaView>
    );
  }

  if (estado === "completada") {
    return (
      <SafeAreaView style={[styles.contenedor, { backgroundColor: "#e3f2fd" }]}>
        <Text style={styles.iconoGrande}>🏥</Text>
        <Text style={styles.tituloEstado}>Atención completada</Text>
        <Text style={styles.subtituloEstado}>
          Has llegado al hospital. Cuídate.
        </Text>
        <TouchableOpacity style={styles.botonPrimario} onPress={resetear}>
          <Text style={styles.botonPrimarioTexto}>Nueva solicitud</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  // ── Idle: botón SOS ──────────────────────────────────────────────

  const barraAncho = progreso.interpolate({
    inputRange: [0, 1],
    outputRange: ["0%", "100%"],
  });

  return (
    <SafeAreaView style={styles.contenedor}>
      <Text style={styles.titulo}>Solicitar Ambulancia</Text>
      <Text style={styles.subtitulo}>
        Mantén presionado el botón{"\n"}3 segundos para llamar a una ambulancia
      </Text>

      <View style={styles.sosWrapper}>
        <View style={styles.anilloExterior}>
          <Pressable
            style={[styles.sosBoton, presionando && styles.sosBotonActivo]}
            onPressIn={onPressIn}
            onPressOut={onPressOut}
          >
            <Text style={styles.sosTexto}>SOS</Text>
            {presionando && (
              <Text style={styles.sosHint}>suelta para{"\n"}cancelar</Text>
            )}
          </Pressable>
        </View>

        <View style={styles.barraContenedor}>
          <Animated.View style={[styles.barra, { width: barraAncho }]} />
        </View>
      </View>

      {!presionando && (
        <Text style={styles.instruccion}>Mantén presionado 3 segundos</Text>
      )}

      <TouchableOpacity
        style={styles.botonFicha}
        onPress={() => router.push("/civil/medical-profile")}
      >
        <Text style={styles.botonFichaTexto}>Ficha médica</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.botonSecundario, styles.botonSalir]}
        onPress={() => supabase.auth.signOut()}
      >
        <Text style={styles.botonSecundarioTexto}>Cerrar sesión</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  contenedor: {
    flex: 1,
    backgroundColor: "#f5f5f5",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
    gap: 16,
  },
  titulo: {
    fontSize: 22,
    fontWeight: "700",
    color: "#222",
    textAlign: "center",
  },
  subtitulo: {
    fontSize: 14,
    color: "#666",
    textAlign: "center",
    lineHeight: 21,
  },
  sosWrapper: {
    alignItems: "center",
    gap: 20,
    marginVertical: 28,
  },
  anilloExterior: {
    width: 190,
    height: 190,
    borderRadius: 95,
    borderWidth: 4,
    borderColor: "#ffcdd2",
    justifyContent: "center",
    alignItems: "center",
  },
  sosBoton: {
    width: 168,
    height: 168,
    borderRadius: 84,
    backgroundColor: "#d32f2f",
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#d32f2f",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.45,
    shadowRadius: 12,
    elevation: 10,
  },
  sosBotonActivo: {
    backgroundColor: "#b71c1c",
    transform: [{ scale: 0.95 }],
    shadowOpacity: 0.6,
  },
  sosTexto: {
    fontSize: 38,
    fontWeight: "900",
    color: "#fff",
    letterSpacing: 3,
  },
  sosHint: {
    fontSize: 11,
    color: "rgba(255,255,255,0.75)",
    textAlign: "center",
    marginTop: 6,
    lineHeight: 16,
  },
  barraContenedor: {
    width: 190,
    height: 7,
    backgroundColor: "#ffcdd2",
    borderRadius: 4,
    overflow: "hidden",
  },
  barra: {
    height: "100%",
    backgroundColor: "#d32f2f",
    borderRadius: 4,
  },
  instruccion: {
    fontSize: 13,
    color: "#aaa",
    textAlign: "center",
  },
  iconoGrande: { fontSize: 64 },
  tituloEstado: {
    fontSize: 24,
    fontWeight: "700",
    color: "#222",
    textAlign: "center",
  },
  subtituloEstado: {
    fontSize: 15,
    color: "#555",
    textAlign: "center",
    lineHeight: 23,
  },
  botonPrimario: {
    backgroundColor: "#1565c0",
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 32,
    marginTop: 8,
  },
  botonPrimarioTexto: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 15,
  },
  botonSecundario: {
    borderWidth: 1,
    borderColor: "#d32f2f",
    borderRadius: 10,
    paddingVertical: 11,
    paddingHorizontal: 28,
    marginTop: 8,
  },
  botonSecundarioTexto: {
    color: "#d32f2f",
    fontWeight: "600",
    fontSize: 14,
  },
  botonFicha: {
    borderWidth: 1,
    borderColor: "#1565c0",
    borderRadius: 10,
    paddingVertical: 11,
    paddingHorizontal: 28,
  },
  botonFichaTexto: {
    color: "#1565c0",
    fontWeight: "600",
    fontSize: 14,
  },
  botonSalir: {
    position: "absolute",
    bottom: 40,
  },
});
