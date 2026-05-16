import Constants from "expo-constants";
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
import MapView, { Marker, PROVIDER_GOOGLE } from "react-native-maps";
import MapViewDirections from "react-native-maps-directions";
import { supabase } from "../../lib/supabase";
import { playSound } from "../../lib/sounds";

const DURACION_SOS = 3000;

const GOOGLE_MAPS_API_KEY =
  Constants.expoConfig?.android?.config?.googleMaps?.apiKey ??
  Constants.expoConfig?.ios?.config?.googleMapsApiKey ?? "";

const REGION_DEFECTO = {
  latitude: 40.4168,
  longitude: -3.7038,
  latitudeDelta: 0.05,
  longitudeDelta: 0.05,
};

export default function CivilHomeScreen() {
  // idle | esperando | aceptada | en_camino | completada
  const [estado, setEstado] = useState("idle");

  const [userId, setUserId] = useState(null);
  const [ubicacion, setUbicacion] = useState(null);
  const [alertaId, setAlertaId] = useState(null);
  const [presionando, setPresionando] = useState(false);

  const [conductorUbicacion, setConductorUbicacion] = useState(null);

  const progreso = useRef(new Animated.Value(0)).current;
  const animRef = useRef(null);
  const presionandoRef = useRef(false);
  const channelRef = useRef(null);
  const locationChannelRef = useRef(null);
  const mapRef = useRef(null);
  const router = useRouter();

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) setUserId(user.id);
    });
    obtenerUbicacion();
    return () => {
      channelRef.current?.unsubscribe();
      locationChannelRef.current?.unsubscribe();
    };
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

    playSound("sos");
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
          if (alerta.status === "accepted") {
            playSound("aceptado");
            setEstado("aceptada");
            if (alerta.driver_id) suscribirseUbicacionConductor(alerta.driver_id);
          }
          if (alerta.status === "in_transit") setEstado("en_camino");
          if (alerta.status === "done") setEstado("completada");
          if (alerta.status === "cancelled") {
            limpiarConductor();
            setEstado("idle");
            setAlertaId(null);
            progreso.setValue(0);
          }
        }
      )
      .subscribe();
  }

  async function suscribirseUbicacionConductor(driverId) {
    const { data } = await supabase
      .from("locations")
      .select("latitude, longitude")
      .eq("driver_id", driverId)
      .single();
    if (data) setConductorUbicacion({ latitude: data.latitude, longitude: data.longitude });

    locationChannelRef.current = supabase
      .channel(`civil-conductor-loc-${driverId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "locations",
          filter: `driver_id=eq.${driverId}`,
        },
        ({ new: loc }) => {
          if (loc?.latitude && loc?.longitude)
            setConductorUbicacion({ latitude: loc.latitude, longitude: loc.longitude });
        }
      )
      .subscribe();
  }

  function limpiarConductor() {
    locationChannelRef.current?.unsubscribe();
    locationChannelRef.current = null;
    setConductorUbicacion(null);
  }

  async function cancelarAlerta() {
    playSound("cancelado");
    if (alertaId) {
      await supabase
        .from("emergencies")
        .update({ status: "cancelled" })
        .eq("id", alertaId);
    }
    channelRef.current?.unsubscribe();
    limpiarConductor();
    setEstado("idle");
    setAlertaId(null);
    progreso.setValue(0);
  }

  function resetear() {
    channelRef.current?.unsubscribe();
    limpiarConductor();
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
    const civilCoord = ubicacion
      ? { latitude: ubicacion.lat, longitude: ubicacion.lng }
      : null;

    return (
      <SafeAreaView style={styles.contenedorMapa}>
        <MapView
          ref={mapRef}
          style={styles.mapaCompleto}
          provider={PROVIDER_GOOGLE}
          initialRegion={
            civilCoord
              ? { ...civilCoord, latitudeDelta: 0.04, longitudeDelta: 0.04 }
              : REGION_DEFECTO
          }
        >
          {civilCoord && (
            <Marker coordinate={civilCoord} title="Tu ubicación" pinColor="#1565c0" />
          )}
          {conductorUbicacion && (
            <Marker coordinate={conductorUbicacion} title="Ambulancia" pinColor="#d32f2f" />
          )}
          {civilCoord && conductorUbicacion && (
            <MapViewDirections
              origin={conductorUbicacion}
              destination={civilCoord}
              apikey={GOOGLE_MAPS_API_KEY}
              strokeWidth={4}
              strokeColor="#d32f2f"
              resetOnChange={false}
            />
          )}
        </MapView>

        <View style={styles.cardAceptada}>
          <Text style={styles.cardTitulo}>🚑 ¡Ambulancia en camino!</Text>
          <Text style={styles.cardSubtitulo}>
            {conductorUbicacion
              ? "Posición del conductor actualizada en tiempo real."
              : "Localizando al conductor..."}
          </Text>
        </View>
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

  // ── Mapa de seguimiento (estado aceptada) ────────────────────────
  contenedorMapa: {
    flex: 1,
    backgroundColor: "#000",
  },
  mapaCompleto: {
    flex: 1,
  },
  cardAceptada: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "#fff",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 36,
    gap: 6,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 8,
  },
  cardTitulo: {
    fontSize: 18,
    fontWeight: "700",
    color: "#222",
    textAlign: "center",
  },
  cardSubtitulo: {
    fontSize: 14,
    color: "#666",
    textAlign: "center",
    lineHeight: 21,
  },
});
