# 🏢 CONTEXTO DEL PROYECTO — KIA DEALER MANAGEMENT SYSTEM

## Descripción del Negocio

El **Concesionario KIA** opera un taller de accesorización y entrega de vehículos nuevos. El proceso inicia cuando un vehículo llega desde un concesionario de origen y termina con la entrega oficial al cliente final. El sistema digitaliza y controla cada paso de ese ciclo con trazabilidad completa.

---

## Sedes del Concesionario KIA

| Sede | Código | Particularidades |
|------|--------|-----------------|
| SurMotor | `SURMOTOR` | Sede principal. Tiene todos los roles diferenciados (Asesor de Servicio, Asesor de Entrega, Líder Técnico son personas distintas) |
| Shyris | `SHYRIS` | Una sola persona puede cumplir los roles de Asesor de Servicio, Asesor de Entrega y Líder Técnico simultáneamente |
| Granadas-Centenos | `GRANADAS_CENTENOS` | Sede secundaria |

---

## Concesionarios de Origen (Proveedores de Vehículos)

Son los concesionarios desde donde llegan los vehículos al taller KIA:

- LogiManta
- AsiaAuto
- Kmotor
- Empromotor
- Motricentro
- IOKars

Estos son datos maestros gestionados desde la sección de catálogos por el Jefe de Taller o el Personal de Documentación.

---

## Enum de Estados del Vehículo

```typescript
enum VehicleStatus {
  // FASE 1 — INGRESO Y CERTIFICACIÓN
  RECEPCIONADO         = "Recepcionado en Taller",
  CERTIFICADO_STOCK    = "Certificado en Stock",

  // FASE 2 — DOCUMENTACIÓN
  DOCUMENTACION_PENDIENTE = "Documentación Pendiente",
  DOCUMENTADO          = "Documentado",

  // FASE 3 — ACCESORIZACIÓN
  ORDEN_GENERADA       = "Orden de Trabajo Generada",
  ASIGNADO             = "Asignado a Técnico",
  EN_INSTALACION       = "En Instalación",
  INSTALACION_COMPLETA = "Instalación Completada",

  // FASE 4 — ENTREGA
  LISTO_PARA_ENTREGA   = "Listo para Entrega",
  AGENDADO             = "Agendado para Entrega",
  ENTREGADO            = "Entregado",

  // ESTADOS DE EXCEPCIÓN
  REAPERTURA_OT        = "Reapertura de Orden",
  CEDIDO               = "Cedido a otro Concesionario"
}
```

---

## Entidades Principales (Interfaces TypeScript)

### Vehicle

```typescript
interface Vehicle {
  id: string;
  chassis: string;                     // Único. Ingresado por QR
  model: string;                       // Ref a catálogo de modelos
  year: number;                        // >= año actual
  color: string;                       // Ref a catálogo de colores
  originConcessionaire: string;        // Ref a catálogo de concesionarios
  photoUrl: string;                    // Firebase Storage URL
  sede: SedeEnum;
  status: VehicleStatus;

  // Trazabilidad de fechas
  receptionDate: Timestamp;
  certificationDate?: Timestamp;
  documentationDate?: Timestamp;
  installationCompleteDate?: Timestamp;
  deliveryDate?: Timestamp;

  // Trazabilidad de usuarios (uid)
  receivedBy: string;
  certifiedBy?: string;
  documentedBy?: string;
  installedBy?: string;
  deliveredBy?: string;

  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

### StatusHistoryEntry (Subcolección de Vehicle)

```typescript
// vehicles/{vehicleId}/statusHistory/{historyId}
interface StatusHistoryEntry {
  id: string;
  previousStatus: VehicleStatus;
  newStatus: VehicleStatus;
  changedBy: string;         // uid del usuario
  changedByName: string;     // nombre para visualización
  changedAt: Timestamp;
  sede: SedeEnum;
  notes?: string;            // Motivo de reapertura u observación
}
```

### Certification

```typescript
// certifications/{vehicleId}
interface Certification {
  vehicleId: string;
  radio: 'INSTALADO' | 'NO_INSTALADO';
  rims: {
    status: 'VIENE' | 'RAYADOS' | 'NO_VINIERON';
    photoUrl?: string;
  };
  seatType: 'CUERO' | 'TELA' | 'TELA_Y_CUERO';
  antenna: 'TIBURON' | 'CONVENCIONAL';
  trunkCover: 'INSTALADO' | 'NO_INSTALADO';
  mileage: number;           // Alerta si > 10 km
  imprints: 'CON_IMPRONTAS' | 'SIN_IMPRONTAS';
  certifiedAt: Timestamp;
  certifiedBy: string;
}
```

### Documentation

```typescript
// documentations/{vehicleId}
interface Documentation {
  vehicleId: string;
  clientName: string;
  clientId: string;          // Cédula
  clientPhone: string;
  registrationType: 'NORMAL' | 'RAPIDA' | 'EXCLUSIVA';

  // Firebase Storage URLs (PDFs)
  vehicleInvoiceUrl?: string;
  giftEmailUrl?: string;
  accessoryInvoiceUrl?: string;

  accessories: AccessoryClassification[];

  documentationStatus: 'PENDIENTE' | 'COMPLETO';
  documentedAt?: Timestamp;
  documentedBy: string;
}

interface AccessoryClassification {
  key: AccessoryKey;
  classification: 'VENDIDO' | 'OBSEQUIADO' | 'NO_APLICA';
  notes?: string;            // Solo para el campo "otros"
}

enum AccessoryKey {
  BOTON_ENCENDIDO = 'boton_encendido',
  KIT_CARRETERA   = 'kit_carretera',
  AROS            = 'aros',
  LAMINAS         = 'laminas',
  MOQUETAS        = 'moquetas',
  CUBREMALETAS    = 'cubremaletas',
  SEGURO          = 'seguro',
  TELEMETRIA      = 'telemetria',
  SENSORES        = 'sensores',
  ALARMA          = 'alarma',
  NEBLINEROS      = 'neblineros',
  KIT_SEGURIDAD   = 'kit_seguridad',
  PROTECTOR_CER   = 'protector_ceramico',
  OTROS           = 'otros'
}
```

### ServiceOrder

```typescript
// serviceOrders/{orderId}
interface ServiceOrder {
  id: string;
  orderNumber: string;
  vehicleId: string;
  sede: SedeEnum;

  accessories: OrderAccessory[];
  predictions: AccessoryPrediction[];

  assignedTechnicianId?: string;
  assignedTechnicianName?: string;
  assignedAt?: Timestamp;

  isReopening: boolean;
  reopeningReason?: string;
  previousOrderId?: string;

  generatedBy: string;
  generatedAt: Timestamp;
  completedAt?: Timestamp;

  status: 'GENERADA' | 'ASIGNADA' | 'EN_INSTALACION' | 'COMPLETADA';
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

interface OrderAccessory {
  key: AccessoryKey;
  classification: 'VENDIDO' | 'OBSEQUIADO';
  installed: boolean;        // Checklist del técnico
  installedAt?: Timestamp;
}

interface AccessoryPrediction {
  key: AccessoryKey;
  probability: number;       // 0-100
  reason: string;            // Explicación del algoritmo
}
```

### Appointment

```typescript
// appointments/{appointmentId}
interface Appointment {
  id: string;
  vehicleId: string;
  scheduledDate: Timestamp;
  scheduledTime: string;     // "HH:MM"
  assignedAdvisorId: string;
  assignedAdvisorName: string;
  sede: SedeEnum;
  status: 'AGENDADO' | 'REAGENDADO' | 'COMPLETADO';
  createdBy: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

### DeliveryCeremony

```typescript
// deliveryCeremonies/{vehicleId}
interface DeliveryCeremony {
  vehicleId: string;
  appointmentId: string;
  deliveryPhotoUrl: string;    // Foto con el vehículo — Firebase Storage
  signedActaUrl: string;       // Foto del acta firmada — Firebase Storage
  clientComment: string;
  deliveredBy: string;         // uid del asesor
  deliveredAt: Timestamp;
}
```

### Notification

```typescript
// notifications/{notificationId}
interface Notification {
  id: string;
  targetUid?: string;          // null = broadcast a un rol/sede
  targetRole?: RoleEnum;
  targetSede?: SedeEnum;
  type: NotificationType;
  title: string;
  body: string;
  vehicleId?: string;
  chassis?: string;
  read: boolean;
  createdAt: Timestamp;
}

enum NotificationType {
  ESTADO_CAMBIADO     = 'estado_cambiado',
  KILOMETRAJE_ALTO    = 'kilometraje_alto',
  SIN_IMPRONTAS       = 'sin_improntas',
  OT_GENERADA         = 'ot_generada',
  TECNICO_ASIGNADO    = 'tecnico_asignado',
  INSTALACION_LISTA   = 'instalacion_lista',
  LISTO_ENTREGA       = 'listo_entrega',
  AGENDADO            = 'agendado',
  REAPERTURA          = 'reapertura',
  CAMBIO_SEDE         = 'cambio_sede',
  CEDIDO              = 'cedido',
  ALERTA_JEFE         = 'alerta_jefe'
}
```

---

## Catálogos Maestros

Colecciones gestionadas por Jefe de Taller y Personal de Documentación:

```
catalogs/
├── colors/{id}             → { name, hexCode }
├── models/{id}             → { name, brand: 'KIA' }
├── concessionaires/{id}    → { name, active }
├── sedes/{id}              → { name, code, active }
└── accessories/{id}        → { key, label, active }
```

Estos datos se obtienen al iniciar la app y se cachean localmente para que los formularios de ingreso y certificación funcionen sin requerir múltiples requests.

---

## Reglas de Negocio Críticas

1. **Año del vehículo** siempre debe ser `>= new Date().getFullYear()`. La validación es dinámica, no estática.
2. **Chasis es único** en todo el sistema. Si se intenta registrar un chasis ya existente, el backend retorna error 409.
3. **Cambio de estado** solo puede avanzar en la secuencia definida, excepto `REAPERTURA_OT` que puede retroceder desde `EN_INSTALACION` o `LISTO_PARA_ENTREGA`.
4. **Para generar OT**, el vehículo debe estar en estado `DOCUMENTADO` (no `DOCUMENTACION_PENDIENTE`).
5. **Kilometraje > 10 km** dispara una notificación automática al Jefe de Taller.
6. **Vehículo CEDIDO** es un estado final. No puede avanzar ni retroceder dentro del sistema local.
7. **El checklist de instalación** solo puede ser completado por el técnico cuyo `uid` está asignado en la OT.
8. **La ceremonia de entrega** solo puede ser ejecutada por el asesor cuyo `uid` está en el agendamiento.