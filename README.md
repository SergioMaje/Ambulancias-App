# Ambulancias App

Aplicación móvil de despacho de emergencias médicas en tiempo real, construida con React Native + Expo y Supabase como backend.

---

## Tabla de contenidos

- [Descripción](#descripción)
- [Stack tecnológico](#stack-tecnológico)
- [Arquitectura](#arquitectura)
- [Roles de usuario](#roles-de-usuario)
- [Flujo de autenticación](#flujo-de-autenticación)
- [Esquema de base de datos](#esquema-de-base-de-datos)
- [Pipeline de notificaciones push](#pipeline-de-notificaciones-push)
- [Estructura de carpetas](#estructura-de-carpetas)
- [Configuración del entorno](#configuración-del-entorno)
- [Comandos de desarrollo](#comandos-de-desarrollo)
- [Funcionalidades implementadas](#funcionalidades-implementadas)
- [Pendiente](#pendiente)

---

## Descripción

Ambulancias App conecta a **civiles** que necesitan asistencia médica urgente con **conductores de ambulancia** disponibles. El civil activa una alerta SOS, el conductor más cercano la recibe por notificación push, la acepta, y ambos se comunican el estado de la emergencia en tiempo real mediante Supabase Realtime.

---

## Stack tecnológico

| Capa | Tecnología |
|---|---|
| UI / Navegación | React Native 0.81 + Expo Router v6 |
| Backend / Auth | Supabase (PostgreSQL + Auth + Realtime) |
| Notificaciones | Expo Push Notifications + Supabase Edge Functions |
| Mapas / GPS | React Native Maps (Google Maps) + expo-location |
| Animaciones | React Native Reanimated v4 |
| Almacenamiento | AsyncStorage (sesión) + expo-secure-store |

---

## Arquitectura

```
┌─────────────────────────────────────────────────┐
│                  Expo Router v6                 │
│  app/_layout.tsx  (orquesta auth + navegación)  │
└───────────┬────────────────────────┬────────────┘
            │                        │
     ┌──────▼──────┐          ┌──────▼──────┐
     │  (auth)/    │          │   Roles     │
     │  login      │          │  /civil/    │
     │  register   │          │  /conductor/│
     │  onboarding │          └─────────────┘
     └─────────────┘
            │
     ┌──────▼──────────────────────────────┐
     │            Supabase                  │
     │  Auth  │  PostgreSQL  │  Realtime   │
     │        │  Edge Funcs  │  Webhooks   │
     └─────────────────────────────────────┘
```

El layout raíz (`app/_layout.tsx`) escucha cambios de sesión y perfil, y redirige automáticamente según el estado:

```
Sin sesión              →  (auth)/login
Sesión sin perfil       →  (auth)/onboarding
Sesión + role=civil     →  /civil/
Sesión + role=conductor →  /conductor/
```

---

## Roles de usuario

### Civil (solicitante de emergencia)

- Activa un SOS mediante un botón de presión sostenida (3 segundos, anti-accidental).
- Envía su ubicación GPS actual.
- Sigue el estado de su emergencia en tiempo real: `pendiente → aceptada → en_camino → completada`.
- Puede cancelar mientras espera.
- Tiene acceso a su ficha médica (tipo de sangre, alergias, condiciones, medicamentos).

### Conductor (paramédico / ambulanciero)

- Inicia turno ingresando placa y código de ambulancia.
- Activa/desactiva su rastreo GPS en tiempo real.
- Recibe alertas push de nuevas emergencias cercanas.
- Acepta o rechaza alertas.
- Accede a la ficha médica del paciente al aceptar.
- Confirma recogida del paciente y llegada al hospital.

---

## Flujo de autenticación

```
Registro (register.jsx)
  └─► Supabase Auth (email + password)
      └─► Onboarding (onboarding.jsx)
          └─► Crea fila en profiles con role='civil'
              └─► Redirige a /civil/

Login (login.jsx)
  └─► Supabase Auth
      └─► _layout.tsx lee profiles.role
          ├─► role='civil'     → /civil/
          └─► role='conductor' → /conductor/
```

> Los conductores son creados con `role='conductor'` directamente por el administrador en Supabase; no pueden autoregistrarse como conductores.

---

## Esquema de base de datos

```sql
-- Perfiles de usuario (todos los roles)
profiles (
  id              uuid PRIMARY KEY REFERENCES auth.users,
  role            text,           -- 'civil' | 'conductor'
  full_name       text,
  expo_push_token text
)

-- Emergencias (ciclo de vida completo)
emergencias (
  id              uuid PRIMARY KEY,
  civil_id        uuid REFERENCES profiles,
  conductor_id    uuid REFERENCES profiles,
  lat             float,
  lng             float,
  estado          text,           -- 'pendiente' | 'aceptada' | 'recogido' | 'cancelada'
  created_at      timestamptz,
  updated_at      timestamptz
)

-- Ficha médica del civil
ficha_medica (
  id              uuid PRIMARY KEY REFERENCES profiles,
  nombre          text,
  fecha_nacimiento date,
  grupo_sanguineo text,           -- 'A+' | 'A-' | 'B+' | 'B-' | 'AB+' | 'AB-' | 'O+' | 'O-'
  alergias        text,
  condiciones     text,
  medicamentos    text,
  contacto_emergencia   text,
  telefono_emergencia   text
)

-- Ubicaciones en tiempo real de conductores
conductor_locations (
  id        uuid PRIMARY KEY REFERENCES profiles,
  lat       float,
  lng       float,
  heading   float,
  activo    boolean,
  updated_at timestamptz
)
```

Las migraciones viven en `supabase/migrations/`. El esquema para tokens push está en `push_notifications.sql`.

---

## Pipeline de notificaciones push

```
1. App start
   └─► lib/notifications.js registra el dispositivo
       └─► Guarda expo_push_token en profiles

2. INSERT/UPDATE en emergencias
   └─► Database Webhook de Supabase
       └─► Llama a Edge Function send-push

3. send-push/index.ts
   ├─► INSERT (nueva emergencia)
   │     └─► RPC get_nearest_active_driver → token del conductor
   │         └─► Envía "🚨 Nueva alerta SOS" al conductor
   ├─► UPDATE pendiente → aceptada
   │     └─► Token del civil → "✅ ¡Ambulancia en camino!"
   └─► UPDATE aceptada → recogido
         └─► Token del civil → "🚑 Paciente recogido"
```

---

## Estructura de carpetas

```
ambulancias-app/
├── app/
│   ├── _layout.tsx          # Root layout: auth y routing
│   ├── (app)/               # Grupo de redirección transitoria
│   ├── (auth)/
│   │   ├── login.jsx
│   │   ├── register.jsx
│   │   └── onboarding.jsx
│   ├── civil/
│   │   ├── index.jsx         # Botón SOS + seguimiento
│   │   └── medical-profile.jsx
│   └── conductor/
│       └── index.jsx         # Mapa + respuesta a alertas
├── lib/
│   ├── supabase.js           # Cliente Supabase
│   └── notifications.js      # Registro de tokens push
├── supabase/
│   ├── migrations/           # SQL de migraciones
│   └── functions/
│       └── send-push/        # Edge Function (Deno)
├── assets/                   # Fuentes e imágenes
├── components/               # Componentes genéricos (Expo default)
├── constants/                # Colors.ts
├── app.config.js             # Configuración Expo (env vars)
└── CLAUDE.md                 # Guía para Claude Code
```

---

## Configuración del entorno

Crea un archivo `.env.local` en la raíz con:

```env
EXPO_PUBLIC_SUPABASE_URL=https://<tu-proyecto>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<tu-anon-key>
GOOGLE_MAPS_API_KEY=<tu-api-key-de-google-maps>
```

> Las credenciales de Supabase también están referenciadas en `lib/supabase.js`. Asegúrate de no commitear claves reales.

### Supabase

1. Crea un proyecto en [supabase.com](https://supabase.com).
2. Ejecuta las migraciones de `supabase/migrations/`.
3. Despliega la Edge Function: `supabase functions deploy send-push`.
4. Configura el Database Webhook en el dashboard de Supabase apuntando a `send-push` para eventos INSERT/UPDATE en la tabla `emergencias`.
5. Crea la función RPC `get_nearest_active_driver` que retorne los conductores activos más cercanos a unas coordenadas dadas.

### Google Maps

El API key se carga desde `.env` vía `app.config.js`. Se requiere para `react-native-maps` en Android e iOS.

---

## Comandos de desarrollo

```bash
npx expo start           # Servidor de desarrollo (escanear QR con Expo Go)
npx expo start --android # Emulador Android
npx expo start --ios     # Simulador iOS
npx expo start --web     # Versión web

# Supabase CLI
supabase functions deploy send-push   # Despliegar Edge Function
supabase db push                      # Aplicar migraciones
```

---

## Funcionalidades implementadas

- [x] Registro e inicio de sesión (email + password)
- [x] Onboarding automático (creación de perfil)
- [x] Routing basado en rol (`civil` / `conductor`)
- [x] Botón SOS con presión sostenida de 3 segundos (anti-accidental)
- [x] Captura de ubicación GPS del civil al solicitar emergencia
- [x] Seguimiento de estado de emergencia en tiempo real (Realtime)
- [x] Cancelación de emergencia desde el lado del civil
- [x] Ficha médica del civil (CRUD)
- [x] Rastreo GPS del conductor en tiempo real
- [x] Suscripción a nuevas alertas pendientes (conductor)
- [x] Aceptar / rechazar alertas con acceso a ficha médica
- [x] Confirmación de recogida y llegada al hospital
- [x] Integración con Google Maps (mapa interactivo)
- [x] Notificaciones push via Expo + Edge Function

---

## Pendiente

- [ ] **Civil:** Ver la ruta del conductor en tiempo real al ser aceptada la emergencia (suscripción a `conductor_locations` + polilínea en mapa)
- [ ] **Conductor:** Ruta calculada desde su posición hasta el paciente (Google Directions API o `react-native-maps-directions`)
- [ ] **Conductor:** Búsqueda del hospital más cercano al recoger al paciente (Google Places API - Nearby Search) y ruta hacia él
- [ ] Implementar RPC `get_nearest_active_driver` en la base de datos
