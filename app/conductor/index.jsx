import * as Location from "expo-location";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import MapView, { Marker, PROVIDER_GOOGLE } from "react-native-maps";
import { supabase } from "../../lib/supabase";

const REGION_DEFECTO = {
  latitude: 40.4168,
  longitude: -3.7038,
  latitudeDelta: 0.05,
  longitudeDelta: 0.05,
};

// panelModo: 'sinTurno' | 'normal' | 'nuevaAlerta' | 'enCamino' | 'enTransito'

export default function ConductorHomeScreen() {
  const [activo, setActivo] = useState(false);
  const [ubicacion, setUbicacion] = useState(null);
  const [userId, setUserId] = useState(null);
  const [ambulanciaId, setAmbulanciaId] = useState(null);
  const [panelModo, setPanelModo] = useState("sinTurno");
  const [alertaActiva, setAlertaActiva] = useState(null);
  const [fichaMedica, setFichaMedica] = useState(null);

  const [placa, setPlaca] = useState("");
  const [codigo, setCodigo] = useState("");
  const [vinculando, setVinculando] = useState(false);

  const locationSubRef = useRef(null);
  const alertChannelRef = useRef(null);
  const mapRef = useRef(null);
  const panelModoRef = useRef("sinTurno");

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return;
      setUserId(user.id);

      // Verificar si ya tiene un turno activo (ambulancia vinculada)
      const { data } = await supabase
        .from("ambulances")
        .select("id")
        .eq("driver_id", user.id)
        .single();

      if (data) {
        setAmbulanciaId(data.id);
        setPanelModo("normal");
        panelModoRef.current = "normal";
      }
    });
    return () => {
      locationSubRef.current?.remove();
      alertChannelRef.current?.unsubscribe();
    };
  }, []);

  useEffect(() => {
    panelModoRef.current = panelModo;
  }, [panelModo]);

  // ── Iniciar turno ────────────────────────────────────────────────

  async function iniciarTurno() {
    if (!placa.trim() || !codigo.trim()) {
      Alert.alert("Campos requeridos", "Ingresa la placa y el código de conductor.");
      return;
    }

    setVinculando(true);

    const { data: ambulancia, error } = await supabase
      .from("ambulances")
      .select("id, driver_id")
      .eq("plate", placa.trim().toUpperCase())
      .eq("code", codigo.trim())
      .single();

    if (error || !ambulancia) {
      Alert.alert("Datos incorrectos", "Placa o código no válidos. Contacta al administrador.");
      setVinculando(false);
      return;
    }

    if (ambulancia.driver_id && ambulancia.driver_id !== userId) {
      Alert.alert("No disponible", "Esta ambulancia ya tiene un turno activo con otro conductor.");
      setVinculando(false);
      return;
    }

    const { error: updateError } = await supabase
      .from("ambulances")
      .update({ driver_id: userId })
      .eq("id", ambulancia.id)
      .is("driver_id", null);

    if (updateError) {
      Alert.alert("Error", "No se pudo iniciar el turno. Inténtalo de nuevo.");
      setVinculando(false);
      return;
    }

    setAmbulanciaId(ambulancia.id);
    setPlaca("");
    setCodigo("");
    setVinculando(false);
    setPanelModo("normal");
  }

  // ── Suscripción a alertas nuevas (solo cuando activo) ────────────

  useEffect(() => {
    if (!activo) {
      alertChannelRef.current?.unsubscribe();
      alertChannelRef.current = null;
      return;
    }

    alertChannelRef.current = supabase
      .channel(`conductor-emergencia-${Date.now()}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "emergencies" },
        ({ new: alerta }) => {
          if (
            alerta.status === "pending" &&
            panelModoRef.current === "normal"
          ) {
            setAlertaActiva(alerta);
            setPanelModo("nuevaAlerta");
          }
        }
      )
      .subscribe();

    return () => alertChannelRef.current?.unsubscribe();
  }, [activo]);

  // ── GPS tracking ─────────────────────────────────────────────────

  async function toggleActivo(nuevoEstado) {
    if (!userId) return;

    if (nuevoEstado) {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        Alert.alert(
          "Permiso denegado",
          "Necesitamos acceso a tu ubicación para activarte en el mapa."
        );
        return;
      }

      await supabase
        .from("ambulances")
        .update({ active: true })
        .eq("driver_id", userId);

      locationSubRef.current = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          timeInterval: 5000,
          distanceInterval: 10,
        },
        async (loc) => {
          const { latitude, longitude } = loc.coords;
          setUbicacion({ latitude, longitude });
          mapRef.current?.animateToRegion(
            { latitude, longitude, latitudeDelta: 0.005, longitudeDelta: 0.005 },
            500
          );
          await supabase.from("locations").upsert(
            {
              driver_id: userId,
              latitude,
              longitude,
              position: `POINT(${longitude} ${latitude})`,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "driver_id" }
          );
        }
      );
    } else {
      locationSubRef.current?.remove();
      locationSubRef.current = null;

      await supabase
        .from("ambulances")
        .update({ active: false })
        .eq("driver_id", userId);

      if (panelModoRef.current !== "normal") {
        setPanelModo("normal");
        setAlertaActiva(null);
        setFichaMedica(null);
      }
    }
    setActivo(nuevoEstado);
  }

  // ── Aceptar alerta ───────────────────────────────────────────────

  async function aceptarAlerta() {
    if (!alertaActiva || !userId) return;

    const { error } = await supabase
      .from("emergencies")
      .update({
        driver_id: userId,
        status: "accepted",
        accepted_at: new Date().toISOString(),
      })
      .eq("id", alertaActiva.id)
      .eq("status", "pending");

    if (error) {
      Alert.alert("Alerta no disponible", "Otro conductor puede haberla tomado antes.");
      setPanelModo("normal");
      setAlertaActiva(null);
      return;
    }

    mapRef.current?.animateToRegion(
      {
        latitude: alertaActiva.latitude,
        longitude: alertaActiva.longitude,
        latitudeDelta: 0.02,
        longitudeDelta: 0.02,
      },
      800
    );

    const { data: ficha } = await supabase
      .from("medical_profiles")
      .select("*")
      .eq("user_id", alertaActiva.user_id)
      .single();

    setFichaMedica(ficha ?? null);
    setPanelModo("enCamino");
  }

  function rechazarAlerta() {
    setPanelModo("normal");
    setAlertaActiva(null);
  }

  // ── Paciente recogido (accepted → in_transit) ────────────────────

  function marcarRecogido() {
    Alert.alert(
      "Confirmar recogida",
      "¿Confirmas que has recogido al paciente?",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Confirmar",
          onPress: async () => {
            await supabase
              .from("emergencies")
              .update({
                status: "in_transit",
                picked_up_at: new Date().toISOString(),
              })
              .eq("id", alertaActiva.id)
              .eq("driver_id", userId);
            setPanelModo("enTransito");
          },
        },
      ]
    );
  }

  // ── Llegada al hospital (in_transit → done) ──────────────────────

  function marcarCompletado() {
    Alert.alert(
      "Confirmar llegada",
      "¿Confirmas que han llegado al hospital?",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Confirmar",
          onPress: async () => {
            await supabase
              .from("emergencies")
              .update({
                status: "done",
                completed_at: new Date().toISOString(),
              })
              .eq("id", alertaActiva.id)
              .eq("driver_id", userId);
            setPanelModo("normal");
            setAlertaActiva(null);
            setFichaMedica(null);
          },
        },
      ]
    );
  }

  // ── Cerrar sesión / terminar turno ───────────────────────────────

  async function handleLogout() {
    Alert.alert("Cerrar sesión", "¿Seguro que quieres salir?", [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Salir",
        style: "destructive",
        onPress: async () => {
          locationSubRef.current?.remove();
          if (userId) {
            await supabase
              .from("ambulances")
              .update({ active: false, driver_id: null })
              .eq("driver_id", userId);
          }
          await supabase.auth.signOut();
        },
      },
    ]);
  }

  // ── Render ───────────────────────────────────────────────────────

  // Pantalla de inicio de turno (sin mapa)
  if (panelModo === "sinTurno") {
    return (
      <KeyboardAvoidingView
        style={styles.turnoContenedor}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.turnoInner}>
          <Text style={styles.turnoTitulo}>Iniciar turno</Text>
          <Text style={styles.turnoSubtitulo}>
            Ingresa la placa de tu vehículo y el código de conductor para comenzar.
          </Text>

          <TextInput
            style={styles.turnoInput}
            placeholder="Placa (ej: ABC-1234)"
            placeholderTextColor="#aaa"
            value={placa}
            onChangeText={setPlaca}
            autoCapitalize="characters"
            autoCorrect={false}
          />

          <TextInput
            style={styles.turnoInput}
            placeholder="Código de conductor"
            placeholderTextColor="#aaa"
            value={codigo}
            onChangeText={setCodigo}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
          />

          <TouchableOpacity
            style={[styles.turnoBoton, vinculando && styles.botonDeshabilitado]}
            onPress={iniciarTurno}
            disabled={vinculando}
          >
            {vinculando ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.turnoBotonTexto}>Iniciar turno</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity style={styles.botonSalirTurno} onPress={() => supabase.auth.signOut()}>
            <Text style={styles.botonSalirTexto}>Cerrar sesión</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    );
  }

  return (
    <SafeAreaView style={styles.contenedor}>
      <MapView
        ref={mapRef}
        style={panelModo === "enCamino" || panelModo === "enTransito" ? styles.mapaReducido : styles.mapa}
        provider={PROVIDER_GOOGLE}
        initialRegion={REGION_DEFECTO}
        showsUserLocation={false}
        showsMyLocationButton={false}
        toolbarEnabled={false}
      >
        {ubicacion && (
          <Marker coordinate={ubicacion} title="Mi ubicación" pinColor="#d32f2f" />
        )}
        {alertaActiva && (
          <Marker
            coordinate={{
              latitude: alertaActiva.latitude,
              longitude: alertaActiva.longitude,
            }}
            title="Paciente"
            description="Ubicación de la alerta"
            pinColor="#1565c0"
          />
        )}
      </MapView>

      {/* Panel normal: toggle GPS */}
      {panelModo === "normal" && (
        <View style={styles.panel}>
          <View style={styles.estadoFila}>
            <View>
              <Text style={styles.estadoLabel}>Estado</Text>
              <Text style={[styles.estadoValor, activo ? styles.estadoActivo : styles.estadoInactivo]}>
                {activo ? "● Activo" : "○ Inactivo"}
              </Text>
            </View>
            <Switch
              value={activo}
              onValueChange={toggleActivo}
              trackColor={{ false: "#ddd", true: "#ffcdd2" }}
              thumbColor={activo ? "#d32f2f" : "#aaa"}
            />
          </View>
          {activo && (
            <Text style={styles.infoGps}>GPS activo · Transmitiendo posición en tiempo real</Text>
          )}
          <TouchableOpacity style={styles.botonSalir} onPress={handleLogout}>
            <Text style={styles.botonSalirTexto}>Cerrar sesión</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Panel nueva alerta */}
      {panelModo === "nuevaAlerta" && alertaActiva && (
        <View style={[styles.panel, styles.panelAlerta]}>
          <View style={styles.alertaCabecera}>
            <Text style={styles.alertaTitulo}>🚨 Nueva alerta</Text>
            <Text style={styles.alertaSubtitulo}>Paciente necesita asistencia urgente</Text>
          </View>

          <View style={styles.fichaCard}>
            <FilaDato etiqueta="Latitud" valor={alertaActiva.latitude?.toFixed(5)} />
            <FilaDato etiqueta="Longitud" valor={alertaActiva.longitude?.toFixed(5)} />
            <FilaDato
              etiqueta="Recibida a las"
              valor={new Date(alertaActiva.created_at).toLocaleTimeString("es-ES", {
                hour: "2-digit", minute: "2-digit", second: "2-digit",
              })}
            />
          </View>

          <View style={styles.botonesFila}>
            <TouchableOpacity
              style={[styles.botonAccion, styles.botonRechazar]}
              onPress={rechazarAlerta}
            >
              <Text style={styles.botonRechazarTexto}>Ignorar</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.botonAccion, styles.botonAceptar]}
              onPress={aceptarAlerta}
            >
              <Text style={styles.botonAceptarTexto}>Aceptar alerta</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Panel en camino: ficha médica + botón recogido */}
      {panelModo === "enCamino" && (
        <ScrollView
          style={styles.panelScroll}
          contentContainerStyle={styles.panelScrollContenido}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.enCaminoTitulo}>En camino al paciente</Text>

          <View style={styles.fichaCard}>
            <Text style={styles.fichaTituloSeccion}>Ficha médica</Text>
            {fichaMedica ? (
              <>
                <FilaDato etiqueta="Grupo sanguíneo" valor={fichaMedica.blood_type} />
                <FilaDato etiqueta="Alergias" valor={fichaMedica.allergies} />
                <FilaDato etiqueta="Enfermedades crónicas" valor={fichaMedica.chronic_diseases} />
                <FilaDato etiqueta="Medicamentos" valor={fichaMedica.medications} />
              </>
            ) : (
              <Text style={styles.sinFicha}>Sin ficha médica registrada</Text>
            )}
          </View>

          <View style={styles.fichaCard}>
            <Text style={styles.fichaTituloSeccion}>Ubicación del paciente</Text>
            <FilaDato etiqueta="Lat" valor={alertaActiva?.latitude?.toFixed(6)} />
            <FilaDato etiqueta="Lng" valor={alertaActiva?.longitude?.toFixed(6)} />
          </View>

          <TouchableOpacity style={styles.botonRecogido} onPress={marcarRecogido}>
            <Text style={styles.botonRecogidoTexto}>Llegué al paciente</Text>
          </TouchableOpacity>
        </ScrollView>
      )}

      {/* Panel en tránsito: camino al hospital */}
      {panelModo === "enTransito" && (
        <View style={styles.panelTransito}>
          <Text style={styles.enCaminoTitulo}>Paciente recogido</Text>
          <Text style={styles.transitoSubtitulo}>
            Dirígete al hospital y confirma la llegada.
          </Text>
          <TouchableOpacity style={styles.botonHospital} onPress={marcarCompletado}>
            <Text style={styles.botonRecogidoTexto}>Llegamos al hospital</Text>
          </TouchableOpacity>
        </View>
      )}
    </SafeAreaView>
  );
}

function FilaDato({ etiqueta, valor }) {
  return (
    <View style={styles.filaDato}>
      <Text style={styles.filaDatoEtiqueta}>{etiqueta}</Text>
      <Text style={styles.filaDatoValor} numberOfLines={2}>
        {valor ?? "—"}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  contenedor: { flex: 1, backgroundColor: "#000" },
  mapa: { flex: 1 },
  mapaReducido: { height: 220 },

  // ── Pantalla de turno ──────────────────────────────────────────
  turnoContenedor: { flex: 1, backgroundColor: "#f5f5f5" },
  turnoInner: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 28,
    gap: 16,
  },
  turnoTitulo: {
    fontSize: 26,
    fontWeight: "700",
    color: "#222",
    textAlign: "center",
    marginBottom: 4,
  },
  turnoSubtitulo: {
    fontSize: 14,
    color: "#666",
    textAlign: "center",
    lineHeight: 21,
    marginBottom: 8,
  },
  turnoInput: {
    backgroundColor: "#fff",
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    fontSize: 15,
    color: "#222",
    borderWidth: 1,
    borderColor: "#e0e0e0",
  },
  turnoBoton: {
    backgroundColor: "#d32f2f",
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: "center",
    marginTop: 8,
  },
  turnoBotonTexto: { color: "#fff", fontWeight: "700", fontSize: 16 },
  botonSalirTurno: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },

  // ── Panel principal ────────────────────────────────────────────
  panel: {
    backgroundColor: "#fff",
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 28,
    gap: 12,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 8,
  },
  estadoFila: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  estadoLabel: {
    fontSize: 12,
    color: "#999",
    marginBottom: 2,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  estadoValor: { fontSize: 18, fontWeight: "700" },
  estadoActivo: { color: "#2e7d32" },
  estadoInactivo: { color: "#aaa" },
  infoGps: { fontSize: 12, color: "#666", textAlign: "center" },
  botonSalir: {
    marginTop: 4,
    borderWidth: 1,
    borderColor: "#d32f2f",
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  botonSalirTexto: { color: "#d32f2f", fontWeight: "600", fontSize: 15 },
  botonDeshabilitado: { opacity: 0.6 },

  panelAlerta: { gap: 16 },
  alertaCabecera: { gap: 2 },
  alertaTitulo: { fontSize: 20, fontWeight: "800", color: "#b71c1c" },
  alertaSubtitulo: { fontSize: 13, color: "#666" },
  botonesFila: { flexDirection: "row", gap: 12 },
  botonAccion: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: "center",
  },
  botonRechazar: { borderWidth: 1, borderColor: "#ccc" },
  botonRechazarTexto: { color: "#666", fontWeight: "600", fontSize: 14 },
  botonAceptar: { backgroundColor: "#d32f2f" },
  botonAceptarTexto: { color: "#fff", fontWeight: "700", fontSize: 14 },

  panelScroll: { flex: 1, backgroundColor: "#f5f5f5" },
  panelScrollContenido: { padding: 20, gap: 16, paddingBottom: 40 },
  enCaminoTitulo: {
    fontSize: 18,
    fontWeight: "700",
    color: "#1565c0",
    textAlign: "center",
    marginBottom: 4,
  },

  panelTransito: {
    flex: 1,
    backgroundColor: "#fff8e1",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
    gap: 16,
  },
  transitoSubtitulo: {
    fontSize: 15,
    color: "#555",
    textAlign: "center",
  },

  fichaCard: {
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 16,
    gap: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  fichaTituloSeccion: {
    fontSize: 13,
    fontWeight: "700",
    color: "#999",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  sinFicha: {
    fontSize: 14,
    color: "#aaa",
    fontStyle: "italic",
    textAlign: "center",
    paddingVertical: 8,
  },

  filaDato: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 8,
  },
  filaDatoEtiqueta: { fontSize: 13, color: "#888", flex: 1 },
  filaDatoValor: {
    fontSize: 13,
    color: "#222",
    fontWeight: "600",
    flex: 2,
    textAlign: "right",
  },

  botonRecogido: {
    backgroundColor: "#2e7d32",
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
    shadowColor: "#2e7d32",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  botonHospital: {
    backgroundColor: "#1565c0",
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 32,
    alignItems: "center",
    shadowColor: "#1565c0",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  botonRecogidoTexto: {
    color: "#fff",
    fontWeight: "800",
    fontSize: 16,
    letterSpacing: 0.3,
  },
});
