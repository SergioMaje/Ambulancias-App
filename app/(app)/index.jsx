// app/(app)/index.jsx
// Pantalla de transición — solo se ve el instante en que _layout.tsx
// determina el rol del usuario y redirige a /civil/ o /conductor/.
// Nunca debería mostrarse más de un par de frames.
import { ActivityIndicator, StyleSheet, View } from "react-native";

export default function AppIndex() {
  return (
    <View style={styles.contenedor}>
      <ActivityIndicator size="large" color="#d32f2f" />
    </View>
  );
}

const styles = StyleSheet.create({
  contenedor: {
    flex: 1,
    backgroundColor: "#f5f5f5",
    justifyContent: "center",
    alignItems: "center",
  },
});
