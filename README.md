# Ambulancias App

Aplicación móvil de despacho de emergencias médicas en tiempo real, construida con **React Native + Expo** y **Supabase** como backend completo.

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
- [Progreso del proyecto](#progreso-del-proyecto)
- [Pendiente / Roadmap](#pendiente--roadmap)

---

## Descripción

**Ambulancias App** conecta a civiles que necesitan asistencia médica urgente con conductores de ambulancia disponibles.

El flujo principal es:

1. El **civil** pulsa y mantiene el botón SOS (3 segundos, anti-accidental).
2. La app captura su GPS y crea una emergencia en la base de datos.
3. El **conductor** recibe una notificación push al instante y la acepta desde el mapa.
4. El conductor transmite su ubicación GPS en vivo mientras se desplaza.
5. Ambos ven el estado actualizarse en tiempo real: `pendiente → aceptada → recogido`.

---

## Stack tecnológico

| Capa | Tecnología |
|---|---|
| UI / Navegación | React Native 0.81 + Expo Router v6 |
| Backend / Auth | Supabase (PostgreSQL + Auth + Realtime) |
| Notificaciones push | Expo Push Notifications + Supabase Edge Functions (Deno) |
| Mapas / GPS | React Native Maps 1.20 (Google Maps) + expo-location |
| Animaciones | React Native Reanimated v4 |
| Sesión local | AsyncStorage + expo-secure-store |

---

## Arquitectura

```
┌─────────────────────────────────────────────────┐
│                  Expo Router v6                 │
│  app/_layout.tsx  (orquesta auth + navegación)  │
└───────────┬────────────────────────┬────────────┘
            │                        │
     ┌──────▼──────┐          ┌──────▼──────────┐
     │  (auth)/    │          │     Roles        │
     │  login      │          │  /civil/         │
     │  register   │          │  /conductor/     │
     │  onboarding │          └─────────────────┘
     └─────────────┘
            │
     ┌──────▼──────────────────────────────┐
     │              Supabase               │
     │  Auth  │  PostgreSQL  │  Realtime   │
     │        │  Edge Funcs  │  Webhooks   │
     └─────────────────────────────────────┘
```

El root layout (`app/_layout.tsx`) escucha cambios de sesión y perfil, y redirige automáticamente:

```
Sin sesión               →  (auth)/login
Sesión sin perfil        →  (auth)/onboarding
Sesión + role=civil      →  /civil/
Sesión + role=conductor  →  /conductor/
```

---

## Roles de usuario

### Civil (solicitante de emergencia)

- Activa una alerta SOS mediante botón de presión sostenida de **3 segundos** (anti-accidental con barra de progreso animada).
- La app captura automáticamente su **ubicación GPS** al enviar la alerta.
- Sigue el estado de su emergencia en **tiempo real** vía Supabase Realtime.
- Puede **cancelar** la emergencia mientras sigue en estado `pendiente`.
- Gestiona su **ficha médica**: tipo de sangre, alergias, condiciones crónicas, medicamentos y contacto de emergencia.

### Conductor (paramédico / ambulanciero)

- Inicia turno introduciendo **placa y código** de ambulancia para vincularla.
- Activa/desactiva su **rastreo GPS en tiempo real** (upsert continuo en `conductor_locations`).
- Recibe **alertas push** de nuevas emergencias pendientes y las ve en el mapa.
- Acepta o rechaza alertas; al aceptar ve la **ficha médica del paciente**.
- Confirma **recogida del paciente** (`recogido`) al llegar a su ubicación.

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
          ├─► role='civil'      →  /civil/
          └─► role='conductor'  →  /conductor/
```

> Los conductores son dados de alta directamente por el administrador en Supabase con `role='conductor'`. No pueden auto-registrarse como conductores desde la app.

---

## Esquema de base de datos

```sql
-- Perfiles de usuario (todos los roles)
profiles (
  id              uuid  PRIMARY KEY REFERENCES auth.users,
  role            text,              -- 'civil' | 'conductor'
  full_name       text,
  expo_push_token text
)

-- Ambulancias vinculables a conductores
ambulances (
  id        uuid  PRIMARY KEY,
  placa     text,
  codigo    text,
  driver_id uuid  REFERENCES profiles
)

-- Emergencias (ciclo de vida completo)
emergencias (
  id           uuid  PRIMARY KEY,
  civil_id     uuid  REFERENCES profiles,
  conductor_id uuid  REFERENCES profiles,
  lat          float,
  lng          float,
  estado       text,   -- 'pendiente' | 'aceptada' | 'recogido' | 'cancelada'
  created_at   timestamptz,
  updated_at   timestamptz
)

-- Ficha médica del civil
ficha_medica (
  id                   uuid  PRIMARY KEY REFERENCES profiles,
  nombre               text,
  fecha_nacimiento     date,
  grupo_sanguineo      text,  -- 'A+' | 'A-' | 'B+' | 'B-' | 'AB+' | 'AB-' | 'O+' | 'O-'
  alergias             text,
  condiciones          text,
  medicamentos         text,
  contacto_emergencia  text,
  telefono_emergencia  text
)

-- Posiciones GPS en tiempo real de los conductores
conductor_locations (
  id         uuid  PRIMARY KEY REFERENCES profiles,
  lat        float,
  lng        float,
  heading    float,
  activo     boolean,
  updated_at timestamptz
)
```

Las migraciones viven en `supabase/migrations/`. El esquema de tokens push está en `push_notifications.sql`.

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
   │     └─► Busca conductor activo más cercano
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
│   ├── _layout.tsx              # Root layout: auth, sesión y routing
│   ├── (app)/
│   │   └── index.jsx            # Pantalla de redirección transitoria
│   ├── (auth)/
│   │   ├── login.jsx
│   │   ├── register.jsx
│   │   └── onboarding.jsx       # Creación de perfil post-registro
│   ├── civil/
│   │   ├── _layout.jsx
│   │   ├── index.jsx            # Botón SOS + seguimiento de estado
│   │   └── medical-profile.jsx  # Ficha médica (CRUD)
│   └── conductor/
│       ├── _layout.jsx
│       └── index.jsx            # Mapa + gestión de alertas + GPS
├── lib/
│   ├── supabase.js              # Cliente Supabase configurado
│   └── notifications.js         # Registro de tokens push
├── supabase/
│   ├── migrations/
│   │   └── push_notifications.sql
│   └── functions/
│       └── send-push/
│           └── index.ts         # Edge Function (Deno/TypeScript)
├── assets/                      # Fuentes e imágenes
├── constants/
│   └── Colors.ts
├── app.config.js                # Configuración Expo (carga env vars)
├── CLAUDE.md                    # Guía para Claude Code
└── PENDIENTE.md                 # Detalles de tareas en curso
```

---

## Configuración del entorno

Crea un archivo `.env.local` en la raíz con:

```env
EXPO_PUBLIC_SUPABASE_URL=https://<tu-proyecto>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<tu-anon-key>
GOOGLE_MAPS_API_KEY=<tu-api-key-de-google-maps>
```

> `.env.local` está en `.gitignore` — nunca se sube al repositorio.

### Setup de Supabase

1. Crear proyecto en [supabase.com](https://supabase.com).
2. Ejecutar las migraciones de `supabase/migrations/`.
3. Desplegar la Edge Function: `supabase functions deploy send-push`.
4. Configurar un **Database Webhook** en el dashboard de Supabase apuntando a `send-push` para eventos INSERT y UPDATE en la tabla `emergencias`.

### Google Maps

El API key se inyecta desde `.env.local` vía `app.config.js`. Es necesario para `react-native-maps` en Android e iOS.

---

## Comandos de desarrollo

```bash
npx expo start           # Servidor de desarrollo (escanear QR con Expo Go)
npx expo start --android # Emulador Android
npx expo start --ios     # Simulador iOS
npx expo start --web     # Versión web

# Supabase CLI
supabase functions deploy send-push   # Desplegar Edge Function
supabase db push                      # Aplicar migraciones
```

---

## Progreso del proyecto

### Sprint 1 — completado

| Funcionalidad | Estado |
|---|---|
| Registro e inicio de sesión (email + password) | ✅ |
| Onboarding automático (creación de perfil) | ✅ |
| Routing por rol: `civil` / `conductor` | ✅ |
| Botón SOS con presión sostenida 3 s (anti-accidental) | ✅ |
| Captura de GPS del civil al solicitar emergencia | ✅ |
| Seguimiento de estado en tiempo real (Realtime) | ✅ |
| Cancelación de emergencia (lado civil) | ✅ |
| Ficha médica del civil (CRUD completo) | ✅ |
| Vinculación de ambulancia por placa + código | ✅ |
| Rastreo GPS del conductor en tiempo real | ✅ |
| Recepción de alertas pendientes (conductor) | ✅ |
| Aceptar/rechazar alertas con vista de ficha médica | ✅ |
| Confirmar recogida del paciente | ✅ |
| Mapa interactivo con Google Maps | ✅ |
| Notificaciones push vía Expo + Edge Function | ✅ |

---

## Pendiente / Roadmap

### Civil — ruta del conductor en tiempo real
Cuando el conductor acepte la emergencia, mostrar en el mapa del civil la posición del conductor actualizándose en vivo y la ruta trazada hasta él.

- Suscribirse a UPDATE en `conductor_locations` filtrando por el `conductor_id` asignado.
- Dibujar una polilínea desde el conductor hasta el civil.

### Conductor — ruta al paciente
Al aceptar una alerta, trazar la ruta más corta desde la posición del conductor hasta la ubicación del paciente (no solo el marcador).

- Integrar `react-native-maps-directions` o Google Directions API.

### Conductor — ruta al hospital más cercano
Al marcar al paciente como recogido, calcular y mostrar la ruta al hospital más cercano.

- Google Places API (Nearby Search, `type: hospital`).
- Guardar el hospital seleccionado en la fila de `emergencias`.

### Base de datos — RPC de conductor más cercano
Implementar la función RPC `get_nearest_active_driver` en PostgreSQL para que la Edge Function seleccione al conductor activo más próximo a las coordenadas de la emergencia (usando `ST_Distance` o cálculo Haversine).
