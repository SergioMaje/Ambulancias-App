import { Audio } from 'expo-av';

const sounds = {};
let initialized = false;

export async function loadSounds() {
  if (initialized) return;
  await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });

  const files = {
    alerta:     require('../assets/sounds/alerta.wav'),
    sos:        require('../assets/sounds/sos.wav'),
    aceptado:   require('../assets/sounds/aceptado.wav'),
    recogido:   require('../assets/sounds/recogido.wav'),
    completado: require('../assets/sounds/completado.wav'),
    cancelado:  require('../assets/sounds/cancelado.wav'),
  };

  await Promise.all(
    Object.entries(files).map(async ([key, source]) => {
      const { sound } = await Audio.Sound.createAsync(source);
      sounds[key] = sound;
    })
  );
  initialized = true;
}

export async function playSound(name) {
  try {
    const sound = sounds[name];
    if (!sound) return;
    await sound.setPositionAsync(0);
    await sound.playAsync();
  } catch (_) {}
}

export async function unloadSounds() {
  await Promise.all(Object.values(sounds).map((s) => s.unloadAsync()));
  initialized = false;
}
