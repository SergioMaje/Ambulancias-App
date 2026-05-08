// lib/notifications.js
// Utilidades para Expo Push Notifications:
//   - Pedir permisos y obtener el Expo Push Token
//   - Guardar el token en la tabla profiles de Supabase
//   - Configurar cómo se muestran las notificaciones en primer plano

import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { supabase } from './supabase';

// En Expo Go en Android (SDK 53+) las push remotas no están soportadas.
// Las notificaciones en primer plano y Realtime siguen funcionando.
const isExpoGo = Constants.appOwnership === 'expo';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/**
 * Pide permisos y devuelve el Expo Push Token.
 * En Expo Go + Android devuelve null (sin crash) porque SDK 53
 * eliminó las push remotas de Expo Go en Android.
 */
export async function registerForPushNotificationsAsync() {
  // Expo Go en Android no soporta push remotas desde SDK 53
  if (isExpoGo && Platform.OS === 'android') return null;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('emergencia', {
      name: 'Alertas SOS',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#d32f2f',
      sound: true,
    });
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') return null;

  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ??
    Constants.easConfig?.projectId;

  try {
    const tokenData = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined
    );
    return tokenData.data;
  } catch {
    return null;
  }
}

/**
 * Guarda el token en profiles.expo_push_token para que el backend
 * pueda enviar notificaciones a este dispositivo.
 */
export async function savePushToken(userId, token) {
  if (!userId || !token) return;
  const { error } = await supabase
    .from('profiles')
    .update({ expo_push_token: token })
    .eq('id', userId);
  if (error) console.error('[savePushToken]', error.message);
}
