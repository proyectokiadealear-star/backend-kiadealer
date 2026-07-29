# KIA Dealer — Configuración de Firestore

> **Este documento describe todo lo que debes configurar en Firebase/Firestore antes de arrancar el backend por primera vez.**

---

## 1. Variables de Entorno (`.env`)

Copia `.env.example` como `.env` en la raíz de `backend/` y llena cada campo:

```env
FIREBASE_PROJECT_ID=<id-del-proyecto-en-firebase>
FIREBASE_CLIENT_EMAIL=<email-de-la-service-account>
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
FIREBASE_STORAGE_BUCKET=<project-id>.appspot.com
PREDICTION_THRESHOLD=40
NODE_ENV=development
PORT=3000
CORS_ORIGIN=*
```

### Cómo obtener las credenciales de Firebase Admin SDK

1. Abre [Firebase Console](https://console.firebase.google.com) → tu proyecto
2. ⚙️ Configuración del proyecto → **Cuentas de servicio**
3. Click en **Generar nueva clave privada** → descarga el JSON
4. Copia `project_id` → `FIREBASE_PROJECT_ID`
5. Copia `client_email` → `FIREBASE_CLIENT_EMAIL`
6. Copia `private_key` → `FIREBASE_PRIVATE_KEY` (mantén las `\n` literales entre comillas dobles)
7. El bucket de Storage está en **Storage → Archivos** → la URL `gs://<bucket>` → quita `gs://`

---

## 2. Modos de Firestore

- Ve a **Firestore Database → Crear base de datos**
- Selecciona **Modo Producción** (las reglas de seguridad se configuran abajo)
- Región recomendada: `us-central1` o `southamerica-east1`

---

## 3. Reglas de Seguridad de Firestore

Copia estas reglas en **Firestore → Reglas**:

```firestore-rules
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // Solo el backend (Admin SDK) tiene acceso total.
    // El frontend NUNCA debe leer/escribir directamente a Firestore.
    // Todas las operaciones pasan por el backend NestJS usando firebase-admin,
    // que ignora estas reglas de cliente.

    // Bloquear TODO acceso directo desde clientes (web/móvil)
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

> **Nota**: El backend usa el **Admin SDK**, el cual tiene acceso total sin pasar por estas reglas. Estas reglas solo afectan al SDK de cliente (web/móvil), garantizando que nadie acceda directamente a Firestore desde el frontend.

---

## 4. Índices Compuestos de Firestore

Crea los siguientes índices en **Firestore → Índices → Índice compuesto**:

### Colección: `vehicles`

| Campo 1 | Orden | Campo 2 | Orden | Campo 3 | Orden |
|---------|-------|---------|-------|---------|-------|
| `sede` | ASC | `status` | ASC | `createdAt` | DESC |
| `sede` | ASC | `createdAt` | DESC | | |
| `status` | ASC | `createdAt` | DESC | | |

### Colección: `serviceOrders`

| Campo 1 | Orden | Campo 2 | Orden | Campo 3 | Orden |
|---------|-------|---------|-------|---------|-------|
| `sede` | ASC | `status` | ASC | `createdAt` | DESC |
| `assignedTechnicianId` | ASC | `createdAt` | DESC | | |
| `vehicleId` | ASC | `createdAt` | DESC | | |

### Colección: `appointments`

| Campo 1 | Orden | Campo 2 | Orden |
|---------|-------|---------|-------|
| `sede` | ASC | `scheduledDate` | ASC |
| `status` | ASC | `scheduledDate` | ASC |

### Colección: `notifications`

| Campo 1 | Orden | Campo 2 | Orden | Campo 3 | Orden |
|---------|-------|---------|-------|---------|-------|
| `targetRole` | ASC | `sede` | ASC | `createdAt` | DESC |
| `targetRole` | ASC | `isRead` | ASC | `createdAt` | DESC |

### Colección: `users`

| Campo 1 | Orden | Campo 2 | Orden | Campo 3 | Orden |
|---------|-------|---------|-------|---------|-------|
| `role` | ASC | `active` | ASC | `sede` | ASC |

---

## 5. Estructura de Colecciones

El backend crea automáticamente los documentos. Aquí está la estructura esperada para referencia:

```
firestore/
├── vehicles/{vehicleId}
│   ├── id, chassis, model, year, color, sede, originConcessionaire
│   ├── status (VehicleStatus), photoUrl, clientId
│   ├── currentOrderId, createdAt, updatedAt
│   └── statusHistory/  (subcolección)
│       └── {historyId}: previousStatus, newStatus, changedBy, changedByName, changedAt, notes
│
├── certifications/{vehicleId}
│   ├── vehicleId, radio, rims{status, photoUrl}, seatType, antenna, trunkCover
│   ├── mileage, imprints, certifiedBy, certifiedAt
│
├── documentations/{vehicleId}
│   ├── vehicleId, clientName, clientId, clientPhone, registrationType
│   ├── accessories[]{key, classification}
│   ├── homologationUrl, invoiceUrl, soatUrl, sedeHistory[]
│   ├── status (PENDIENTE|COMPLETO), isCeded, cededTo, cededDocUrl
│   ├── createdBy, createdAt, updatedAt
│
├── serviceOrders/{orderId}
│   ├── id, orderNumber, vehicleId, sede, chassis
│   ├── accessories[]{key, classification}
│   ├── predictions[]{key, probability, reason}
│   ├── checklist[]{key, installed, installedAt, installedBy}
│   ├── assignedTechnicianId, assignedTechnicianName, assignedAt
│   ├── status, isReopening, previousOrderId
│   ├── createdBy, createdAt, updatedAt
│
├── appointments/{appointmentId}
│   ├── id, vehicleId, sede, chassis, clientName
│   ├── assignedAdvisorId, assignedAdvisorName
│   ├── scheduledDate, scheduledTime, notes
│   ├── status, createdBy, createdAt
│
├── deliveryCeremonies/{vehicleId}
│   ├── vehicleId, chassis, clientName, advisorId, advisorName
│   ├── ceremonyPhotoUrl, signedActaUrl
│   ├── deliveredAt, createdBy, createdAt
│
├── users/{uid}
│   ├── uid, name, email, role, sede, active
│   ├── fcmTokens[], createdBy, createdAt, updatedAt
│
├── notifications/{notificationId}
│   ├── type, title, body, targetRole, sede
│   ├── vehicleId, chassis, isRead, createdAt
│
└── catalogs/
    ├── colors/items/{itemId}: { id, name, hex?, active }
    ├── models/items/{itemId}: { id, name, active }
    ├── concessionaires/items/{itemId}: { id, name, ruc?, active }
    └── sedes/items/{itemId}: { id, name, city, active }
```

---

## 6. Datos Iniciales de Catálogos (Seed)

Debes crear estos documentos manualmente en Firestore o usando la consola de Firebase antes de usar el sistema.

### Concesionarios (`catalogs/concessionaires/items/`)

| id | name | ruc |
|----|------|-----|
| `logimanta` | LogiManta | 1790xxxxxxx001 |
| `asiauto` | AsiaAuto | 1790xxxxxxx001 |
| `kmotor` | Kmotor | 1790xxxxxxx001 |
| `empromotor` | Empromotor | 1790xxxxxxx001 |
| `motricentro` | Motricentro | 1790xxxxxxx001 |
| `iokars` | IOKars | 1790xxxxxxx001 |

### Sedes (`catalogs/sedes/items/`)

| id | name | city |
|----|------|------|
| `surmotor` | SURMOTOR | Quito Sur |
| `shyris` | SHYRIS | Quito Norte |
| `granadas_centenos` | GRANADAS/CENTENOS | Quito Centro |

### Colores de ejemplo (`catalogs/colors/items/`)

| id | name | hex |
|----|------|-----|
| `blanco_perla` | Blanco Perla | #F5F5F0 |
| `negro_ebano` | Negro Ébano | #1C1C1C |
| `plata_platino` | Plata Platino | #C0C0C0 |
| `rojo_chilli` | Rojo Chilli | #C0392B |
| `gris_acero` | Gris Acero Steel | #708090 |

### Modelos de ejemplo (`catalogs/models/items/`)

| id | name |
|----|------|
| `sportage` | Sportage |
| `seltos` | Seltos |
| `picanto` | Picanto |
| `rio` | Rio |
| `sorento` | Sorento |
| `carnival` | Carnival |
| `stinger` | Stinger |

---

## 7. Custom Claims de Firebase Auth

Cada usuario del sistema requiere **Custom Claims** configurados por el backend. Los campos obligatorios son:

```json
{
  "role": "JEFE_TALLER | ASESOR | LIDER_TECNICO | PERSONAL_TALLER | DOCUMENTACION",
  "sede": "SURMOTOR | SHYRIS | GRANADAS_CENTENOS | ALL",
  "active": true
}
```

- El claim `sede = ALL` es exclusivo de `JEFE_TALLER`
- El claim `active = false` bloquea el acceso aunque el token sea válido
- Los claims se configuran automáticamente al crear/actualizar usuarios via `POST /users`

### Crear el primer JEFE_TALLER (admin inicial)

El primer usuario administrador se puede crear con la consola de Firebase:

1. Ve a **Authentication → Agregar usuario** → crea email/contraseña
2. Toma el UID generado
3. Con el backend corriendo, llama a `POST /users` usando un token de Firebase temporal con estos datos:

```json
{
  "email": "admin@kia.com",
  "password": "SuperSecure123!",
  "name": "Administrador KIA",
  "role": "JEFE_TALLER",
  "sede": "ALL"
}
```

Alternativamente, usa el SDK de Admin directamente para asignar los claims al primer usuario.

---

## 8. Firebase Storage — CORS

Para que las URLs firmadas funcionen correctamente desde el frontend, configura CORS del bucket. Crea un archivo `cors.json`:

```json
[
  {
    "origin": ["*"],
    "method": ["GET"],
    "responseHeader": ["Content-Type"],
    "maxAgeSeconds": 3600
  }
]
```

Aplícalo con `gsutil`:

```bash
gsutil cors set cors.json gs://<TU_BUCKET>.appspot.com
```

---

## 9. Firebase Cloud Messaging (FCM)

Para que las notificaciones push lleguen a los dispositivos móviles:

1. En la app móvil (Flutter/React Native), obtén el token FCM del dispositivo
2. Envíalo al backend mediante `POST /users/fcm-token` con el header `Authorization: Bearer <idToken>`
3. El backend guarda el token en `users/{uid}.fcmTokens` (array, soporta múltiples dispositivos)

---

## 10. Checklist de Puesta en Marcha

- [ ] Proyecto Firebase creado con Blaze plan (necesario para llamadas externas desde Cloud Functions si aplica)
- [ ] Firestore en modo Producción creado
- [ ] Reglas de Firestore aplicadas (bloquear acceso cliente)
- [ ] Service Account descargada y `.env` configurado
- [ ] Índices compuestos creados
- [ ] Datos de catálogos ingresados (concesionarios, sedes, modelos, colores)
- [ ] Storage CORS configurado
- [ ] Primer usuario JEFE_TALLER creado con Custom Claims
- [ ] `yarn install` ejecutado en `backend/`
- [ ] `yarn start:dev` exitoso → Swagger disponible en `http://localhost:3000/api`
