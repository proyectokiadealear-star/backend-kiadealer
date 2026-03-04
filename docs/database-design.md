# Diseño de Base de Datos — KIA Dealer Backend
> Motor: **Google Cloud Firestore** (NoSQL, orientado a documentos)  
> Fecha: Marzo 2026

---

## Enums del Sistema

### `VehicleStatus`
| Valor | Fase | Descripción |
|---|---|---|
| `RECEPCIONADO` | Ingreso | Vehículo ingresado al taller |
| `CERTIFICADO_STOCK` | Ingreso | Certificación de stock completada |
| `DOCUMENTACION_PENDIENTE` | Documentación | Documentación guardada parcialmente |
| `DOCUMENTADO` | Documentación | Documentación completa |
| `ORDEN_GENERADA` | Accesorización | OT generada, pendiente de asignación |
| `ASIGNADO` | Accesorización | Técnico asignado a la OT |
| `EN_INSTALACION` | Accesorización | Instalación en progreso |
| `INSTALACION_COMPLETA` | Accesorización | Todos los accesorios instalados |
| `LISTO_PARA_ENTREGA` | Entrega | Aprobado por Líder Técnico |
| `AGENDADO` | Entrega | Ceremonia de entrega agendada |
| `ENTREGADO` | Entrega | Vehículo entregado al cliente |
| `REAPERTURA_OT` | Excepción | OT reabierta para accesorios adicionales |
| `CEDIDO` | Excepción | Vehículo cedido a otro concesionario |

### `RoleEnum`
`ASESOR` | `LIDER_TECNICO` | `PERSONAL_TALLER` | `DOCUMENTACION` | `JEFE_TALLER` | `SOPORTE`

### `SedeEnum`
`SURMOTOR` | `SHYRIS` | `GRANDA_CENTENO` | `ALL`

### `AccessoryClassification`
`VENDIDO` | `OBSEQUIADO` | `NO_APLICA`

### `AccessoryKey` — **Dinámico**
Ya no es un enum estático. Los keys se obtienen del catálogo `catalogs/accessories/items` y pueden ser cualquier string. Los 14 predefinidos por el seed son:
`boton_encendido` | `kit_carretera` | `aros` | `laminas` | `moquetas` | `cubremaletas` | `seguro` | `telemetria` | `sensores` | `alarma` | `neblineros` | `kit_seguridad` | `protector_ceramico` | `otros`

Se pueden agregar accesorios personalizados vía `POST /catalogs/accessories/items`. El `key` se almacena siempre en **minúsculas**.

### `PaymentMethod`
`CONTADO` | `CREDITO`

### `RegistrationType`
`NORMAL` | `RAPIDA` | `EXCLUSIVA`

---

## Colecciones Firestore

---

### `users/{uid}`

Documento de usuario del sistema. El `uid` es el mismo de Firebase Auth.

```
uid:            string        — Firebase Auth UID (= ID del documento)
displayName:    string        — Nombre completo
email:          string        — Correo electrónico
role:           RoleEnum      — Rol del sistema
sede:           SedeEnum      — Sede asignada (ALL para JEFE_TALLER / SOPORTE)
active:         boolean       — true = activo, false = desactivado (borrado lógico)
fcmTokens:      string[]      — Tokens FCM de dispositivos registrados
createdAt:      Timestamp
updatedAt:      Timestamp
createdBy:      string        — UID del JEFE_TALLER que lo creó
```

**Custom Claims (Firebase Auth):** `{ role, sede, active }` — usados por los guards para autorización sin consultar Firestore en cada request.

---

### `vehicles/{vehicleId}`

Documento principal del vehículo. `vehicleId` es UUID v4.

```
id:                       string          — UUID v4
chassis:                  string          — VIN ISO 3779, 17 chars, mayúsculas, único
model:                    string          — Modelo del vehículo, mayúsculas
year:                     number          — Año del vehículo
color:                    string          — Color, mayúsculas
originConcessionaire:     string          — Concesionario de origen, mayúsculas
sede:                     SedeEnum        — Sede asignada (del claim del usuario creador)
status:                   VehicleStatus   — Estado actual en el flujo
photoUrl:                 string | null   — URL firmada de Firebase Storage

-- Fechas de cada fase (null hasta que ocurren) --
receptionDate:            Timestamp | null
certificationDate:        Timestamp | null
documentationDate:        Timestamp | null
installationCompleteDate: Timestamp | null
deliveryDate:             Timestamp | null

-- UIDs responsables por fase --
receivedBy:               string          — UID del creador
certifiedBy:              string | null
documentedBy:             string | null
installedBy:              string | null
deliveredBy:              string | null

-- Campos adicionales escritos por changeStatus según fase --
clientId:                 string | null   — Cédula del cliente (de documentación)
currentOrderId:           string | null   — ID de la OT activa
currentOrderNumber:       string | null   — Número de la OT activa
appointmentId:            string | null   — ID del agendamiento activo
deliveredByName:          string | null

createdAt:                Timestamp
updatedAt:                Timestamp
```

**Storage:** `vehicles/{vehicleId}/photo.jpg`

#### Subcolección: `vehicles/{vehicleId}/statusHistory/{historyId}`

```
id:             string          — UUID v4
previousStatus: VehicleStatus | null
newStatus:      VehicleStatus
changedBy:      string          — UID del usuario
changedByName:  string          — Nombre del usuario
changedAt:      Timestamp
sede:           SedeEnum
notes:          string | null   — Descripción del cambio
```

---

### `certifications/{vehicleId}`

Una certficación por vehículo. El documento ID es el mismo `vehicleId`.

```
vehicleId:      string          — Referencia al vehículo
radio:          boolean         — Radio presente
rims: {
  status:       string          — Estado de los aros
  photoUrl:     string | null   — URL firmada de foto de aros
}
seatType:       string          — Tipo de asiento
antenna:        boolean         — Antena presente
trunkCover:     boolean         — Cubremaleta presente
mileage:        number          — Kilometraje (si > 10 km → alerta)
imprints:       ImprintsStatus  — Estado de improntas
notes:          string | null   — Observaciones adicionales
certifiedAt:    Timestamp
certifiedBy:    string          — UID del inspector
```

**Storage:** `vehicles/{vehicleId}/rims-photo.jpg`

---

### `documentations/{vehicleId}`

Una documentación por vehículo. El documento ID es el mismo `vehicleId`.

```
vehicleId:              string                — Referencia al vehículo
clientName:             string                — Nombre del cliente, MAYÚSCULAS
clientId:               string                — Cédula ecuatoriana, 10 dígitos
clientPhone:            string                — Teléfono 09XXXXXXXX
registrationType:       RegistrationType      — NORMAL | RAPIDA | EXCLUSIVA
paymentMethod:          PaymentMethod         — CONTADO | CREDITO
vehicleInvoiceUrl:      string | null         — URL firmada factura vehículo
giftEmailUrl:           string | null         — URL firmada correo obsequio
accessoryInvoiceUrl:    string | null         — URL firmada factura accesorios
accessories: [                                — Array con TODOS los accesorios del catálogo
  {
    key:            string                    — key del catálogo en minúsculas (dinámico)
    classification: AccessoryClassification   — VENDIDO | OBSEQUIADO | NO_APLICA (default: NO_APLICA)
    notes?:         string                    — Texto libre, usado principalmente en key="otros"
  }
]
documentationStatus:    'COMPLETO' | 'PENDIENTE'
documentedAt:           Timestamp | null      — null si está pendiente
documentedBy:           string                — UID del documentador
createdAt:              Timestamp
updatedAt:              Timestamp
```

**Storage:**
- `vehicles/{vehicleId}/docs/vehicle-invoice.pdf`
- `vehicles/{vehicleId}/docs/gift-email.pdf`
- `vehicles/{vehicleId}/docs/accessory-invoice.pdf`

---

### `service-orders/{orderId}`

Orden de Trabajo (OT). `orderId` es UUID v4.

```
id:                     string      — UUID v4
orderNumber:            string      — Ej: "ORD-SURMOTOR-20260303-AB12" o ingresado por usuario
vehicleId:              string      — Referencia al vehículo
sede:                   SedeEnum
chassis:                string      — Chasis del vehículo (desnormalizado)
status:                 string      — GENERADA | ASIGNADA | EN_INSTALACION |
                                      INSTALACION_COMPLETA | LISTO_PARA_ENTREGA | REAPERTURA_OT
accessories: [                      — Solo los clasificados como VENDIDO u OBSEQUIADO
  { key: string, classification: string }
]
checklist: [                        — Estado de instalación por accesorio
  { key: string, installed: boolean }
]
predictions: [                      — Predicciones del algoritmo
  { accessoryKey: string, probability: number, reason: string }
]
assignedTechnicianId:   string | null
assignedTechnicianName: string | null
assignedAt:             Timestamp | null
isReopening:            boolean     — true si es una reapertura
previousOrderId:        string | null — ID de la OT anterior (si isReopening=true)
createdBy:              string
createdByName:          string
createdAt:              Timestamp
updatedAt:              Timestamp
```

---

### `appointments/{appointmentId}`

Agendamiento de ceremonia de entrega. `appointmentId` es UUID v4.

```
id:                   string      — UUID v4
vehicleId:            string      — Referencia al vehículo
chassis:              string      — Desnormalizado
model:                string      — Desnormalizado
sede:                 SedeEnum
scheduledDate:        string      — Formato YYYY-MM-DD
scheduledTime:        string      — Formato HH:MM
assignedAdvisorId:    string      — UID del asesor asignado
assignedAdvisorName:  string      — Nombre del asesor
status:               string      — AGENDADO | ENTREGADO | CANCELADO
createdBy:            string
createdByName:        string
createdAt:            Timestamp
updatedAt:            Timestamp
```

---

### `deliveryCeremonies/{vehicleId}`

Registro de la ceremonia de entrega. El documento ID es el mismo `vehicleId`.

```
vehicleId:          string        — Referencia al vehículo
appointmentId:      string        — Referencia al agendamiento
deliveryPhotoUrl:   string | null — URL firmada foto de entrega
signedActaUrl:      string | null — URL firmada acta firmada
clientComment:      string | null — Comentario del cliente
deliveredBy:        string        — UID del asesor
deliveredByName:    string
createdAt:          Timestamp
```

**Storage:**
- `vehicles/{vehicleId}/delivery/ceremony-photo.jpg`
- `vehicles/{vehicleId}/delivery/signed-acta.jpg`

---

### `notifications/{notifId}`

Notificaciones in-app. `notifId` es UUID v4.

```
id:           string      — UUID v4
type:         string      — ESTADO_CAMBIADO | OT_GENERADA | TECNICO_ASIGNADO |
                            INSTALACION_LISTA | LISTO_ENTREGA | AGENDADO |
                            KILOMETRAJE_ALTO | DOCUMENTACION_PENDIENTE |
                            DOCUMENTACION_ACTUALIZADA | REAPERTURA_OT |
                            TECNICO_REMOVIDO
targetRole:   RoleEnum    — Rol al que va dirigida la notificación
targetSede:   SedeEnum    — Sede destino (ALL = todas las sedes)
title:        string      — Título de la notificación
body:         string      — Cuerpo de la notificación
vehicleId:    string | null
chassis:      string | null
read:         boolean     — false por defecto
createdAt:    Timestamp
```

---

### `catalogs/{type}/items/{id}`

Catálogo dinámico. `type` puede ser: `colors`, `models`, `concessionaires`, `accessories`, `sedes`.

El `id` es un **slug determinista** generado desde el `name`:
- `"KIA SPORTAGE"` → `"kia-sportage"`
- `"BOTON DE ENCENDIDO"` → `"boton-de-encendido"`

```
-- Campos comunes a todos los tipos --
id:         string      — Slug generado desde name
name:       string      — Nombre en MAYÚSCULAS
createdAt:  Timestamp

-- Campo adicional solo en accessories --
key:        string      — Key del accesorio en minúsculas (ej: "boton_encendido", "cubre_lluvias")
                          Dinámico — puede ser cualquier string, no limitado a enum estático

-- Campo adicional solo en sedes --
code:       SedeEnum    — Código de sede (ej: "GRANDA_CENTENO")
```

---

## Flujo de Estados del Vehículo

```
RECEPCIONADO
    │ POST /certifications/:vehicleId
    ▼
CERTIFICADO_STOCK ──────────────────────────────────────────► CEDIDO
    │ POST /documentation/:vehicleId
    ▼
DOCUMENTACION_PENDIENTE ──► (PATCH /documentation/:vehicleId + saveAsPending=false)
    │ POST /documentation/:vehicleId  (sin saveAsPending)
    ▼
DOCUMENTADO
    │ POST /service-orders
    ▼
ORDEN_GENERADA
    │ PATCH /service-orders/:id/assign
    ▼
ASIGNADO
    │ PATCH /service-orders/:id/checklist (primer ítem)
    ▼
EN_INSTALACION
    │ PATCH /service-orders/:id/checklist (último ítem)
    ▼
INSTALACION_COMPLETA
    │ PATCH /service-orders/:id/ready-for-delivery
    ▼
LISTO_PARA_ENTREGA ──────────────────────────────────────────► REAPERTURA_OT
    │ POST /appointments                                              │
    ▼                                                          (vuelve a ORDEN_GENERADA)
AGENDADO
    │ POST /delivery/:vehicleId/ceremony
    ▼
ENTREGADO  (estado final)
```

---

## Relaciones entre Colecciones

```
vehicles (1) ──────────── (1) certifications        vehicleId = doc ID
vehicles (1) ──────────── (1) documentations         vehicleId = doc ID
vehicles (1) ──────────── (1) deliveryCeremonies     vehicleId = doc ID
vehicles (1) ──── subCol ─── statusHistory
vehicles (1) ──────────── (N) service-orders         vehicleId field
vehicles (1) ──────────── (N) appointments           vehicleId field
users    (1) ──────────── (N) notifications          targetRole + targetSede
```

---

## Firebase Storage — Estructura de Paths

```
vehicles/
  {vehicleId}/
    photo.jpg                        ← Foto del vehículo
    rims-photo.jpg                   ← Foto de aros (certificación)
    docs/
      vehicle-invoice.pdf            ← Factura del vehículo
      gift-email.pdf                 ← Correo de obsequio
      accessory-invoice.pdf          ← Factura de accesorios
    delivery/
      ceremony-photo.jpg             ← Foto de entrega
      signed-acta.jpg                ← Acta firmada
```

---

## Notas de Implementación

1. **IDs:** Los vehículos, OTs, agendamientos y notificaciones usan **UUID v4**. Las certificaciones, documentaciones y ceremonias usan el **vehicleId** como ID del documento (relación 1:1).

2. **Índices Firestore:** Se evitan deliberadamente los índices compuestos. Los filtros multi-campo se aplican en memoria después de obtener los resultados con un filtro simple.

3. **URLs firmadas:** Todas las URLs de Storage se regeneran en cada `GET` con `getSignedUrl()` para evitar expiración.

4. **Timestamps:** Todos los documentos usan `serverTimestamp()` del SDK Admin para consistencia de zona horaria.

5. **Catalogs:** Los IDs son slugs deterministas — garantiza que el seed y el API usen el mismo ID para el mismo ítem, evitando duplicados.
