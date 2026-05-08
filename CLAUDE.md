# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npx expo start          # Dev server (scan QR with Expo Go)
npx expo start --android
npx expo start --ios
npx expo start --web
```

No lint or test scripts are configured yet.

## Architecture

### Stack
- **React Native + Expo Router v6** (file-based routing)
- **Supabase** — Auth, PostgreSQL, Realtime, Edge Functions
- **React Native Maps** (Google Maps) for conductor GPS tracking
- **Expo Push Notifications** dispatched via a Supabase Edge Function

### Routing & Auth Flow

The root layout (`app/_layout.tsx`) orchestrates all navigation based on session + profile:

```
No session          →  (auth)/login
Session + no profile →  (auth)/onboarding   (creates profiles row)
Session + role=civil →  civil/
Session + role=conductor → conductor/
```

Auth screens live in `app/(auth)/` (Stack layout). Role screens live in `app/civil/` and `app/conductor/` directly at root — not inside the `(app)` group, which is just a transient redirect screen.

### Two-Role Model

**Civil** (`app/civil/index.jsx`): Emergency requester. Initiates an SOS with a 3-second hold button (anti-accidental). Subscribes via Supabase Realtime to their `emergencia` row to track state changes (pendiente → aceptada → recogido).

**Conductor** (`app/conductor/index.jsx`): Paramedic/driver. Receives real-time alerts for new `pendiente` emergencies, accepts them, and streams their GPS position to `conductor_locations` via `watchPositionAsync()`.

### Database Schema

```sql
profiles        (id, role, full_name, expo_push_token)
emergencia      (id, civil_id, conductor_id, lat, lng, estado, created_at, updated_at)
                 estado: 'pendiente' | 'aceptada' | 'recogido' | 'cancelada'
ficha_medica    (id → profiles.id, nombre, fecha_nacimiento, grupo_sanguineo,
                 alergias, condiciones, medicamentos, contacto_emergencia, telefono_emergencia)
conductor_locations (id → profiles.id, lat, lng, heading, activo, updated_at)
```

Schema migrations live in `supabase/migrations/`. The push notification schema is in `push_notifications.sql`.

### Push Notification Pipeline

1. On app start, `lib/notifications.js` registers the device and stores the Expo push token in `profiles.expo_push_token`.
2. A Supabase Database Webhook on INSERT/UPDATE to `emergencia` triggers the `send-push` Edge Function (`supabase/functions/send-push/index.ts`).
3. The Edge Function queries relevant tokens and sends via Expo Push Service.

### State Management

No Redux or Context — state is managed with React `useState` hooks and Supabase Realtime channel subscriptions. Channels are cleaned up on component unmount.

### Environment

Supabase credentials are configured in `lib/supabase.js`. The Google Maps API key is loaded from the environment in `app.config.js`. Local env vars go in `.env.local`.
