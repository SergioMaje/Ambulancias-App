import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { supabase } from "../../lib/supabase";

const GRUPOS_SANGUINEOS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];

export default function MedicalProfileScreen() {
  const router = useRouter();
  const [userId, setUserId] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [guardando, setGuardando] = useState(false);

  const [bloodType, setBloodType] = useState("");
  const [allergies, setAllergies] = useState("");
  const [chronicDiseases, setChronicDiseases] = useState("");
  const [medications, setMedications] = useState("");

  useEffect(() => {
    async function cargar() {
      setCargando(true);
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setCargando(false);
        return;
      }
      setUserId(user.id);

      const { data } = await supabase
        .from("medical_profiles")
        .select("*")
        .eq("user_id", user.id)
        .single();

      if (data) {
        setBloodType(data.blood_type ?? "");
        setAllergies(data.allergies ?? "");
        setChronicDiseases(data.chronic_diseases ?? "");
        setMedications(data.medications ?? "");
      }
      setCargando(false);
    }
    cargar();
  }, []);

  async function guardarFicha() {
    if (!userId) return;
    setGuardando(true);

    const { error } = await supabase.from("medical_profiles").upsert(
      {
        user_id: userId,
        blood_type: bloodType.trim() || null,
        allergies: allergies.trim() || null,
        chronic_diseases: chronicDiseases.trim() || null,
        medications: medications.trim() || null,
      },
      { onConflict: "user_id" },
    );

    setGuardando(false);

    if (error) {
      Alert.alert("Error", error.message);
      return;
    }

    Alert.alert("Guardado", "Tu ficha médica ha sido actualizada.", [
      { text: "OK", onPress: () => router.back() },
    ]);
  }

  if (cargando) {
    return (
      <View style={styles.centrado}>
        <Text style={styles.cargandoTexto}>Cargando ficha…</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        style={styles.contenedor}
        contentContainerStyle={styles.contenido}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.encabezado}>
          <Text style={styles.titulo}>Ficha médica</Text>
          <Text style={styles.subtitulo}>
            Esta información será visible para el conductor que atienda tu
            emergencia.
          </Text>
        </View>

        <View style={styles.seccion}>
          <Text style={styles.etiqueta}>Grupo sanguíneo</Text>
          <View style={styles.gruposGrid}>
            {GRUPOS_SANGUINEOS.map((g) => (
              <TouchableOpacity
                key={g}
                style={[
                  styles.grupoBtn,
                  bloodType === g && styles.grupoBtnActivo,
                ]}
                onPress={() => setBloodType(bloodType === g ? "" : g)}
              >
                <Text
                  style={[
                    styles.grupoBtnTexto,
                    bloodType === g && styles.grupoBtnTextoActivo,
                  ]}
                >
                  {g}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.seccion}>
          <Text style={styles.etiqueta}>Alergias</Text>
          <TextInput
            style={[styles.input, styles.inputMultilinea]}
            placeholder="Ej: penicilina, látex, mariscos…"
            placeholderTextColor="#bbb"
            value={allergies}
            onChangeText={setAllergies}
            multiline
            numberOfLines={3}
            textAlignVertical="top"
          />
        </View>

        <View style={styles.seccion}>
          <Text style={styles.etiqueta}>Enfermedades crónicas</Text>
          <TextInput
            style={[styles.input, styles.inputMultilinea]}
            placeholder="Ej: diabetes tipo 2, hipertensión…"
            placeholderTextColor="#bbb"
            value={chronicDiseases}
            onChangeText={setChronicDiseases}
            multiline
            numberOfLines={3}
            textAlignVertical="top"
          />
        </View>

        <View style={styles.seccion}>
          <Text style={styles.etiqueta}>Medicamentos habituales</Text>
          <TextInput
            style={[styles.input, styles.inputMultilinea]}
            placeholder="Ej: metformina 850mg, enalapril 10mg…"
            placeholderTextColor="#bbb"
            value={medications}
            onChangeText={setMedications}
            multiline
            numberOfLines={3}
            textAlignVertical="top"
          />
        </View>

        <TouchableOpacity
          style={[styles.botonGuardar, guardando && styles.botonDeshabilitado]}
          onPress={guardarFicha}
          disabled={guardando}
        >
          <Text style={styles.botonGuardarTexto}>
            {guardando ? "Guardando…" : "Guardar ficha"}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  contenedor: { flex: 1, backgroundColor: "#f5f5f5" },
  contenido: { padding: 24, paddingBottom: 20, paddingTop: 60 },
  centrado: { flex: 1, justifyContent: "center", alignItems: "center" },
  cargandoTexto: { fontSize: 15, color: "#666" },

  encabezado: { marginBottom: 24 },
  titulo: { fontSize: 24, fontWeight: "700", color: "#222", marginBottom: 6 },
  subtitulo: { fontSize: 13, color: "#888", lineHeight: 19 },

  seccion: { marginBottom: 20 },
  etiqueta: { fontSize: 13, fontWeight: "600", color: "#555", marginBottom: 8 },

  gruposGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  grupoBtn: {
    borderWidth: 1.5,
    borderColor: "#ddd",
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 14,
    backgroundColor: "#fff",
  },
  grupoBtnActivo: {
    borderColor: "#d32f2f",
    backgroundColor: "#d32f2f",
  },
  grupoBtnTexto: { fontSize: 14, fontWeight: "600", color: "#555" },
  grupoBtnTextoActivo: { color: "#fff" },

  input: {
    backgroundColor: "#fff",
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    fontSize: 14,
    color: "#222",
    borderWidth: 1,
    borderColor: "#e0e0e0",
  },
  inputMultilinea: { minHeight: 80 },

  botonGuardar: {
    backgroundColor: "#d32f2f",
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: "center",
    marginTop: 8,
  },
  botonDeshabilitado: { opacity: 0.6 },
  botonGuardarTexto: { color: "#fff", fontWeight: "700", fontSize: 16 },
});
