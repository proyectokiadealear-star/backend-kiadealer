# 🔄 FLUJO DE TRABAJO — KIA DEALER MANAGEMENT SYSTEM

## Diagrama de Flujo General

```
[Vehículo llega al concesionario]
         │
         ▼
┌─────────────────────┐
│  FASE 1: INGRESO    │  Rol: ASESOR / LIDER_TECNICO / PERSONAL_TALLER
│  RECEPCIONADO       │  → Escaneo QR chasis, foto, datos básicos
└────────┬────────────┘
         │
         ▼
┌─────────────────────┐
│  CERTIFICACIÓN      │  Rol: ASESOR / LIDER_TECNICO / PERSONAL_TALLER
│  CERTIFICADO_STOCK  │  → Radio, aros, asientos, antena, km, improntas
└────────┬────────────┘
         │
         ▼
┌──────────────────────┐
│  FASE 2: DOC.        │  Rol: DOCUMENTACION
│  DOCUMENTACION_PEND. │  → Cliente, PDFs, clasificación accesorios
│  DOCUMENTADO         │  → Completo = DOCUMENTADO / Incompleto = PENDIENTE
└────────┬─────────────┘
         │
         ├────────────────────────────────────────────┐
         │                                            │
         ▼                                            ▼
  [Continúa flujo]                          [Cambio de sede / Cesión]
                                            Estado: CEDIDO (fin local)
         │
         ▼
┌──────────────────────────┐
│  FASE 3: ACCESORIZACIÓN  │
│  ORDEN_GENERADA          │  Rol: ASESOR / LIDER_TECNICO
│  ASIGNADO A TÉCNICO      │  Rol: LIDER_TECNICO (exclusivo)
│  EN_INSTALACION          │  Rol: PERSONAL_TALLER
│  INSTALACION_COMPLETA    │  Rol: PERSONAL_TALLER (checklist)
└────────┬─────────────────┘
         │           ▲
         │           │ Reapertura OT (desde EN_INSTALACION o LISTO_ENTREGA)
         │           │ Rol: ASESOR / LIDER_TECNICO
         ▼
┌──────────────────────┐
│  FASE 4: ENTREGA     │
│  LISTO_PARA_ENTREGA  │  Rol: LIDER_TECNICO (aprueba)
│  AGENDADO            │  Rol: ASESOR / LIDER_TECNICO
│  ENTREGADO           │  Rol: ASESOR asignado (ceremonia)
└──────────────────────┘
```

---

## FASE 1 — Ingreso y Certificación

### 1.1 Ingreso del Vehículo

**Quién:** ASESOR, LIDER_TECNICO, PERSONAL_TALLER  
**Estado resultante:** `RECEPCIONADO`

**Datos requeridos:**
- Chasis (escaneado por QR con `expo-barcode-scanner`)
- Modelo (selector desde catálogo)
- Año (número, validación: >= año actual, resiliente dinámicamente)
- Concesionario de origen (selector desde catálogo)
- Foto del carro (cámara con `expo-camera`)
- Color (selector desde catálogo)
- Sede (asignada automáticamente desde el claim del usuario)

**Registro automático:**
- `receivedBy`: uid del usuario logueado
- `receptionDate`: timestamp del servidor (NestJS)
- `status`: RECEPCIONADO
- Entrada en `statusHistory`: `null → RECEPCIONADO`

**Notificaciones disparadas:**
- Ninguna en este paso (el vehículo aún no está certificado)

---

### 1.2 Certificación Interna y Externa

**Quién:** ASESOR, LIDER_TECNICO, PERSONAL_TALLER  
**Estado resultante:** `CERTIFICADO_STOCK`

**Datos requeridos:**

| Campo | Opciones |
|-------|----------|
| Radio | INSTALADO / NO_INSTALADO |
| Aros | Foto + (VIENE / RAYADOS / NO_VINIERON) |
| Tipo de asientos | CUERO / TELA / TELA_Y_CUERO |
| Antena | TIBURON / CONVENCIONAL |
| Cubre maletas | INSTALADO / NO_INSTALADO |
| Kilometraje | Número (alerta si > 10 km) |
| Improntas | CON_IMPRONTAS / SIN_IMPRONTAS |

**Registros automáticos:**
- `certifiedBy`: uid del usuario
- `certificationDate`: timestamp del servidor
- `status`: CERTIFICADO_STOCK
- Entrada en `statusHistory`

**Notificaciones disparadas:**
- Si `mileage > 10`: notificación `KILOMETRAJE_ALTO` → JEFE_TALLER
- Si `imprints === 'SIN_IMPRONTAS'`: notificación `SIN_IMPRONTAS` → JEFE_TALLER
- Notificación `ESTADO_CAMBIADO` → DOCUMENTACION de la sede (vehículo listo para documentar)

---

## FASE 2 — Documentación

### 2.1 Asociación de Cliente y Documentos

**Quién:** DOCUMENTACION  
**Estado resultante:** `DOCUMENTACION_PENDIENTE` o `DOCUMENTADO`

**Datos del cliente:**
- Nombre completo
- Cédula
- Teléfono
- Tipo de matrícula: NORMAL / RAPIDA / EXCLUSIVA

**Documentos a cargar (PDFs → Firebase Storage):**
- Factura del vehículo
- Correo de obsequio
- Factura de accesorios vendidos

**Clasificación de accesorios:**

| Accesorio | Clasificación |
|-----------|--------------|
| Botón de encendido | VENDIDO / OBSEQUIADO / NO_APLICA |
| Kit de carretera | VENDIDO / OBSEQUIADO / NO_APLICA |
| Aros | VENDIDO / OBSEQUIADO / NO_APLICA |
| Láminas | VENDIDO / OBSEQUIADO / NO_APLICA |
| Moquetas | VENDIDO / OBSEQUIADO / NO_APLICA |
| Cubremaletas | VENDIDO / OBSEQUIADO / NO_APLICA |
| Seguro | VENDIDO / OBSEQUIADO / NO_APLICA |
| Telemetría | VENDIDO / OBSEQUIADO / NO_APLICA |
| Sensores | VENDIDO / OBSEQUIADO / NO_APLICA |
| Alarma | VENDIDO / OBSEQUIADO / NO_APLICA |
| Neblineros | VENDIDO / OBSEQUIADO / NO_APLICA |
| Kit de seguridad | VENDIDO / OBSEQUIADO / NO_APLICA |
| Protector cerámico | VENDIDO / OBSEQUIADO / NO_APLICA |
| Otros | Campo libre de texto |

**Lógica de estado:**
- Si todos los campos requeridos están completos → `DOCUMENTADO`
- Si guarda con campos incompletos → `DOCUMENTACION_PENDIENTE` (modo standby)
- `DOCUMENTACION_PENDIENTE` **bloquea** la generación de OT

**Notificaciones disparadas:**
- `ESTADO_CAMBIADO` → ASESOR/LIDER_TECNICO de la sede (vehículo listo para accesorizar)

---

### 2.2 Cambio de Sede

**Quién:** DOCUMENTACION, JEFE_TALLER  
**Acción:** Buscar vehículo por chasis → seleccionar nueva sede → confirmar

- No cambia el estado del vehículo
- Sí registra entrada en `statusHistory` con nota "Cambio de sede"
- Notificación al JEFE_TALLER: `CAMBIO_SEDE`

---

### 2.3 Cesión a Otro Concesionario

**Quién:** DOCUMENTACION, JEFE_TALLER  
**Estado resultante:** `CEDIDO` (estado final)

**Datos requeridos:**
- Concesionario destino (selector)
- Documento de cesión (PDF → Firebase Storage)

- El vehículo deja de aparecer en el inventario activo
- Queda en historial para consulta con estado `CEDIDO`
- Notificación al JEFE_TALLER: `CEDIDO`

---

## FASE 3 — Accesorización

### 3.1 Generación de Orden de Trabajo

**Quién:** ASESOR, LIDER_TECNICO  
**Prerrequisito:** `status === DOCUMENTADO`  
**Estado resultante:** `ORDEN_GENERADA`

**El sistema automáticamente:**
- Extrae los accesorios clasificados como VENDIDO u OBSEQUIADO
- Genera un número de orden único (`ORD-{sede}-{timestamp}`)
- Ejecuta el algoritmo de predicción de accesorios adicionales
- Muestra predicciones al asesor en la pantalla de OT

**Algoritmo de predicción:**

```
Entradas:
  - Accesorios VENDIDOS del vehículo actual
  - Accesorios OBSEQUIADOS del vehículo actual
  - Historial de clasificaciones de todos los vehículos

Lógica:
  Para cada accesorio NO clasificado (NO_APLICA):
    1. Buscar vehículos con combinaciones similares de VENDIDO/OBSEQUIADO
    2. Calcular % de esos vehículos que también compraron el accesorio no clasificado
    3. Si % > umbral (configurable, default 40%) → incluir en predicciones
    4. Ordenar predicciones por probabilidad descendente

Salida:
  Lista de { accessoryKey, probability, reason }
```

**Notificaciones disparadas:**
- `OT_GENERADA` → LIDER_TECNICO de la sede

---

### 3.2 Asignación de Técnico

**Quién:** LIDER_TECNICO (EXCLUSIVO)  
**Prerrequisito:** `status === ORDEN_GENERADA`  
**Estado resultante:** `ASIGNADO`

- El Líder filtra personal de taller activo (`active: true`) de su sede
- Selecciona uno o más técnicos
- El sistema asigna el `uid` del técnico a la OT

**Notificaciones disparadas:**
- `TECNICO_ASIGNADO` → PERSONAL_TALLER asignado (aparece en su lista de instalaciones)

---

### 3.3 Instalación de Accesorios

**Quién:** PERSONAL_TALLER (solo vehículos asignados a su uid)  
**Estado al iniciar:** `EN_INSTALACION`  
**Estado al completar:** `INSTALACION_COMPLETA`

- El técnico marca cada accesorio del checklist como instalado
- Al marcar el último accesorio → estado automático a `INSTALACION_COMPLETA`
- Registro de `installedBy` (uid) e `installationCompleteDate`

**Notificaciones disparadas:**
- `INSTALACION_LISTA` → LIDER_TECNICO de la sede

---

### 3.4 Aprobación: Listo para Entrega

**Quién:** LIDER_TECNICO  
**Prerrequisito:** `status === INSTALACION_COMPLETA`  
**Estado resultante:** `LISTO_PARA_ENTREGA`

- El Líder valida visualmente la instalación y aprueba
- El sistema actualiza el estado

**Notificaciones disparadas:**
- `LISTO_ENTREGA` → ASESOR de la sede (agendar entrega)

---

### 3.5 Reapertura de Orden de Trabajo

**Quién:** ASESOR, LIDER_TECNICO  
**Cuándo:** Desde `EN_INSTALACION` o `LISTO_PARA_ENTREGA` (venta de accesorio adicional)  
**Estado resultante:** `REAPERTURA_OT`

**Datos requeridos:**
- Accesorios nuevos a agregar (salen como VENDIDO por defecto)
- Motivo de la reapertura (texto obligatorio)

**Flujo:**
1. Asesor genera reapertura → estado `REAPERTURA_OT`
2. Se crea una nueva OT referenciando la anterior (`previousOrderId`)
3. El Líder Técnico reasigna (o mantiene) al técnico
4. El técnico completa el nuevo checklist
5. El flujo continúa normalmente hacia `LISTO_PARA_ENTREGA`

**Notificaciones disparadas:**
- `REAPERTURA` → JEFE_TALLER (alerta de retroceso en flujo)
- `REAPERTURA` → LIDER_TECNICO de la sede

---

## FASE 4 — Gestión de Entrega

### 4.1 Agendamiento de Entrega

**Quién:** ASESOR, LIDER_TECNICO, JEFE_TALLER  
**Prerrequisito:** `status === LISTO_PARA_ENTREGA`  
**Estado resultante:** `AGENDADO`

**Datos requeridos:**
- Fecha de entrega
- Hora de entrega
- Asesor encargado de la entrega (uid + nombre)

**Notificaciones disparadas:**
- `AGENDADO` → ASESOR asignado como entregador
- `AGENDADO` → JEFE_TALLER

---

### 4.2 Ceremonia de Entrega

**Quién:** ASESOR asignado al agendamiento  
**Prerrequisito:** `status === AGENDADO` y es el día de entrega  
**Estado resultante:** `ENTREGADO`

**Pasos de la ceremonia:**
1. Tomar foto con el vehículo (cámara → Firebase Storage)
2. Tomar foto del acta firmada (cámara → Firebase Storage)
3. Registrar comentario del cliente (texto)
4. Confirmar entrega

**Registros automáticos:**
- `deliveredBy`: uid del asesor
- `deliveryDate`: timestamp del servidor
- `status`: ENTREGADO
- Entrada en `statusHistory`

**Notificaciones disparadas:**
- `ESTADO_CAMBIADO` (ENTREGADO) → JEFE_TALLER

---

## Trazabilidad: Estructura del statusHistory

Cada cambio de estado genera automáticamente un documento en la subcolección `vehicles/{vehicleId}/statusHistory`:

| Campo | Tipo | Descripción |
|-------|------|-------------|
| previousStatus | VehicleStatus | Estado anterior |
| newStatus | VehicleStatus | Estado nuevo |
| changedBy | string | uid del usuario |
| changedByName | string | Nombre para visualización |
| changedAt | Timestamp | Momento exacto del cambio |
| sede | SedeEnum | Sede donde ocurrió |
| notes | string? | Motivo (reapertura, cambio de sede) |

**Ejemplo de historial de un vehículo:**

| Estado Anterior | Estado Nuevo | Usuario | Fecha | Sede |
|----------------|--------------|---------|-------|------|
| — | RECEPCIONADO | Asesor Juan | 23/02/2026 08:00 | SurMotor |
| RECEPCIONADO | CERTIFICADO_STOCK | Asesor Juan | 23/02/2026 08:45 | SurMotor |
| CERTIFICADO_STOCK | DOCUMENTADO | Admin María | 23/02/2026 10:00 | SurMotor |
| DOCUMENTADO | ORDEN_GENERADA | Asesor Juan | 23/02/2026 11:00 | SurMotor |
| ORDEN_GENERADA | ASIGNADO | Líder Pedro | 23/02/2026 11:15 | SurMotor |
| ASIGNADO | EN_INSTALACION | Técnico Carlos | 23/02/2026 12:00 | SurMotor |
| EN_INSTALACION | INSTALACION_COMPLETA | Técnico Carlos | 23/02/2026 15:30 | SurMotor |
| INSTALACION_COMPLETA | LISTO_PARA_ENTREGA | Líder Pedro | 23/02/2026 16:00 | SurMotor |
| LISTO_PARA_ENTREGA | AGENDADO | Asesor Juan | 24/02/2026 09:00 | SurMotor |
| AGENDADO | ENTREGADO | Asesor Juan | 25/02/2026 10:00 | SurMotor |