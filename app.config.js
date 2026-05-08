import 'dotenv/config';

export default {
  expo: {
    name: "ambulancias-app",
    slug: "ambulancias-app",
    version: "1.0.0",
    orientation: "portrait",
    icon: "./assets/images/icon.png",
    scheme: "ambulanciasapp",
    userInterfaceStyle: "automatic",
    newArchEnabled: true,
    splash: {
      image: "./assets/images/splash-icon.png",
      resizeMode: "contain",
      backgroundColor: "#ffffff",
    },
    ios: {
      supportsTablet: true,
      config: {
        googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY,
      },
    },
    android: {
      adaptiveIcon: {
        foregroundImage: "./assets/images/adaptive-icon.png",
        backgroundColor: "#ffffff",
      },
      edgeToEdgeEnabled: true,
      predictiveBackGestureEnabled: false,
      config: {
        googleMaps: {
          apiKey: process.env.GOOGLE_MAPS_API_KEY,
        },
      },
    },
    web: {
      bundler: "metro",
      output: "static",
      favicon: "./assets/images/favicon.png",
    },
    plugins: [
      "expo-router",
      "expo-secure-store",
      [
        "expo-notifications",
        {
          color: "#d32f2f",
          androidMode: "default",
          androidCollapsedTitle: "Alerta SOS",
        },
      ],
      [
        "expo-location",
        {
          locationWhenInUsePermission:
            "La app necesita tu ubicación para mostrar tu posición en el mapa.",
          locationAlwaysAndWhenInUsePermission:
            "La app necesita tu ubicación en segundo plano para transmitir tu posición como conductor.",
        },
      ],
    ],
    experiments: {
      typedRoutes: true,
    },
  },
};
