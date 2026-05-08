# Actualizaciones pendientes

## Navegación en tiempo real

### Civil — ver ruta del conductor
Cuando el conductor acepte la emergencia, la pantalla del civil debe mostrar un mapa con la ubicación del conductor actualizándose en tiempo real y la ruta trazada desde el conductor hasta el civil.

**Referencias:**
- Estado `aceptada` en `app/civil/index.jsx` (línea 192)
- Posición del conductor en tabla `locations` (columnas `latitude`, `longitude`)
- Suscribirse a UPDATE en `locations` filtrando por `driver_id` del conductor asignado

### Conductor — ruta al paciente
Al aceptar una alerta, el mapa del conductor debe trazar la ruta más corta desde su posición actual hasta la ubicación del paciente (no solo el marcador).

**Referencias:**
- Panel `enCamino` en `app/conductor/index.jsx`
- Coordenadas del paciente en `alertaActiva.latitude / alertaActiva.longitude`
- Requiere Google Directions API o la prop `MapViewDirections` de `react-native-maps-directions`

### Conductor — ruta al hospital más cercano
Al marcar al paciente como recogido (`in_transit`), el mapa debe calcular y mostrar la ruta al hospital más cercano.

**Referencias:**
- Panel `enTransito` en `app/conductor/index.jsx`
- Requiere Google Places API (Nearby Search, type: hospital) para encontrar el hospital más cercano
- Guardar el hospital seleccionado en `emergencies.hospital_name`, `hospital_latitude`, `hospital_longitude` (columnas ya existen en el esquema)
