# 🔌 ENDPOINTS NESTJS — INTEGRACIÓN FIREBASE Y PANTALLAS

## Configuración Base

### Guards Globales

```typescript
// Todos los endpoints están protegidos por FirebaseAuthGuard
// Los roles se controlan con @Roles() decorator

@Injectable()
export class FirebaseAuthGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const token = extractBearerToken(request.headers.authorization);
    const decoded = await this.firebaseAdmin.auth().verifyIdToken(token);
    if (!decoded.active) throw new UnauthorizedException('Usuario inactivo');
    request.user = decoded; // { uid, role, sede, email, ... }
    return true;
  }
}
```

### Headers requeridos en cada request

```
Authorization: Bearer {firebase-id-token}
Content-Type: application/json
```

---

## MÓDULO: VEHICLES

### Base URL: `/vehicles`

---

#### `POST /vehicles`
**Rol:** ASESOR, LIDER_TECNICO, PERSONAL_TALLER  
**Pantalla:** Móvil → Inicio (botón Ingresar) / Inicio Personal Taller  
**Descripción:** Registra el ingreso de un vehículo nuevo.

**Body:**
```json
{
  "chassis": "9BFPK62M0PB001234",
  "model": "Sportage",
  "year": 2026,
  "color": "Blanco",
  "originConcessionaire": "LogiManta",
  "photoBase64": "data:image/jpeg;base64,...",
  "sede": "SURMOTOR"
}
```

**Lógica interna:**
1. Validar chasis único en Firestore
2. Validar year >= new Date().getFullYear()
3. Subir foto a Firebase Storage en `vehicles/{id}/photo.jpg`
4. Crear documento en `vehicles/{id}` con status `RECEPCIONADO`
5. Registrar en `statusHistory`: null → RECEPCIONADO
6. Retornar vehicleId

**Response 201:**
```json
{
  "id": "abc123",
  "chassis": "9BFPK62M0PB001234",
  "status": "Recepcionado en Taller",
  "photoUrl": "https://signed-url..."
}
```

---

#### `GET /vehicles`
**Rol:** Todos  
**Pantalla:** Stock (web y móvil), Inicio dashboard  
**Query params:**
```
?sede=SURMOTOR
&status=CERTIFICADO_STOCK,DOCUMENTADO
&chassis=9BFPK...
&clientId=1234567890
&page=1&limit=20
```

**Lógica:** Filtra por `sede` del claim del usuario (a menos que sea JEFE_TALLER con `ALL`).

**Response 200:**
```json
{
  "data": [
    {
      "id": "abc123",
      "chassis": "9BFPK62M0PB001234",
      "model": "Sportage",
      "color": "Blanco",
      "status": "Certificado en Stock",
      "photoUrl": "https://signed-url...",
      "sede": "SURMOTOR",
      "receptionDate": "2026-02-23T08:00:00Z",
      "certificationDate": "2026-02-23T08:45:00Z"
    }
  ],
  "total": 45,
  "page": 1,
  "limit": 20
}
```

---

#### `GET /vehicles/:id`
**Rol:** Todos  
**Pantalla:** Detalle de vehículo (Stock → Card → Pantalla completa)

**Response 200:**
```json
{
  "id": "abc123",
  "chassis": "...",
  "model": "Sportage",
  "year": 2026,
  "color": "Blanco",
  "originConcessionaire": "LogiManta",
  "photoUrl": "https://signed-url...",
  "sede": "SURMOTOR",
  "status": "Documentado",
  "receptionDate": "...",
  "certificationDate": "...",
  "documentationDate": "...",
  "receivedBy": "uid-asesor",
  "certifiedBy": "uid-asesor",
  "documentedBy": "uid-admin",
  "certification": { ... },
  "documentation": { ... },
  "statusHistory": [ ... ]
}
```

---

#### `PATCH /vehicles/:id`
**Rol:** JEFE_TALLER  
**Pantalla:** Stock (Jefe) → editar datos del vehículo

**Body:** Cualquier campo editable del vehículo

---

#### `DELETE /vehicles/:id`
**Rol:** JEFE_TALLER  
**Pantalla:** Stock (Jefe) → eliminar vehículo

---

#### `GET /vehicles/:id/status-history`
**Rol:** Todos  
**Pantalla:** Detalle vehículo → sección Trazabilidad / Reportes

**Response 200:**
```json
[
  {
    "id": "h1",
    "previousStatus": null,
    "newStatus": "Recepcionado en Taller",
    "changedBy": "uid",
    "changedByName": "Juan Asesor",
    "changedAt": "2026-02-23T08:00:00Z",
    "sede": "SURMOTOR"
  }
]
```

---

#### `GET /vehicles/stats/by-sede`
**Rol:** JEFE_TALLER  
**Pantalla:** Inicio Jefe (dashboard KPIs)

**Response 200:**
```json
{
  "SURMOTOR": {
    "RECEPCIONADO": 3,
    "CERTIFICADO_STOCK": 5,
    "DOCUMENTADO": 2,
    "EN_INSTALACION": 4,
    "LISTO_PARA_ENTREGA": 1,
    "total": 15
  },
  "SHYRIS": { ... },
  "GRANADAS_CENTENOS": { ... }
}
```

---

#### `GET /vehicles/stats/today-deliveries`
**Rol:** ASESOR, LIDER_TECNICO, JEFE_TALLER  
**Pantalla:** Inicio Asesor (sección "Entregas de hoy")

---

## MÓDULO: CERTIFICATIONS

### Base URL: `/certifications`

---

#### `POST /certifications/:vehicleId`
**Rol:** ASESOR, LIDER_TECNICO, PERSONAL_TALLER  
**Pantalla:** Móvil → Inicio → botón Certificar  
**Prerrequisito:** `vehicle.status === RECEPCIONADO`

**Body (multipart/form-data):**
```
radio: "INSTALADO"
rimsStatus: "VIENE"
rimsPhoto: [archivo imagen]
seatType: "CUERO"
antenna: "TIBURON"
trunkCover: "INSTALADO"
mileage: 5
imprints: "CON_IMPRONTAS"
```

**Lógica interna:**
1. Subir foto de aros a Storage: `vehicles/{id}/rims-photo.jpg`
2. Crear documento en `certifications/{vehicleId}`
3. Actualizar vehicle: status → CERTIFICADO_STOCK, certificationDate, certifiedBy
4. Registrar en statusHistory
5. Si mileage > 10 → FCM a JEFE_TALLER (KILOMETRAJE_ALTO)
6. Si imprints === SIN_IMPRONTAS → FCM a JEFE_TALLER (SIN_IMPRONTAS)
7. FCM a DOCUMENTACION de la sede (ESTADO_CAMBIADO)

**Response 201:**
```json
{
  "vehicleId": "abc123",
  "newStatus": "Certificado en Stock",
  "certificationDate": "2026-02-23T08:45:00Z"
}
```

---

#### `GET /certifications/:vehicleId`
**Rol:** Todos  
**Pantalla:** Detalle vehículo → tab Ingreso/Certificación

---

#### `PATCH /certifications/:vehicleId`
**Rol:** JEFE_TALLER  
**Pantalla:** Stock Jefe → editar certificación

---

## MÓDULO: DOCUMENTATION

### Base URL: `/documentation`

---

#### `POST /documentation/:vehicleId`
**Rol:** DOCUMENTACION  
**Pantalla:** Web → Documentación → formulario completo  
**Prerrequisito:** `vehicle.status === CERTIFICADO_STOCK`

**Body (multipart/form-data):**
```
clientName: "Pedro García"
clientId: "1234567890"
clientPhone: "0991234567"
registrationType: "NORMAL"
vehicleInvoice: [PDF file]
giftEmail: [PDF file]
accessoryInvoice: [PDF file]
accessories: '[{"key":"aros","classification":"VENDIDO"},...]'
saveAsPending: false
```

**Lógica interna:**
1. Subir PDFs a Storage bajo `vehicles/{id}/docs/`
2. Guardar clasificación de accesorios
3. Si `saveAsPending === true` → status DOCUMENTACION_PENDIENTE
4. Si `saveAsPending === false` y todos los requeridos → status DOCUMENTADO
5. Actualizar documentationDate, documentedBy
6. Registrar en statusHistory
7. Si DOCUMENTADO → FCM a ASESOR + LIDER_TECNICO de la sede

**Response 201:**
```json
{
  "vehicleId": "abc123",
  "newStatus": "Documentado | Documentación Pendiente",
  "documentationDate": "..."
}
```

---

#### `GET /documentation/:vehicleId`
**Rol:** DOCUMENTACION, JEFE_TALLER  
**Pantalla:** Stock web → detalle → documentación

**Response 200:** incluye URLs firmadas de cada PDF

---

#### `PATCH /documentation/:vehicleId`
**Rol:** DOCUMENTACION, JEFE_TALLER  
**Pantalla:** Web → editar documentación o reemplazar archivos

---

#### `PATCH /documentation/:vehicleId/sede`
**Rol:** DOCUMENTACION, JEFE_TALLER  
**Pantalla:** Web → Cambio de Sede

**Body:**
```json
{ "newSede": "SHYRIS" }
```

**Lógica:** Actualiza `vehicle.sede`, registra en statusHistory con nota "Cambio de sede". FCM a JEFE_TALLER.

---

#### `PATCH /documentation/:vehicleId/transfer`
**Rol:** DOCUMENTACION, JEFE_TALLER  
**Pantalla:** Web → Cambio de Concesionario

**Body (multipart/form-data):**
```
targetConcessionaire: "AsiaAuto"
transferDocument: [PDF file]
```

**Lógica:** Actualiza status → CEDIDO, sube PDF a `vehicles/{id}/transfer/`, registra en statusHistory. FCM a JEFE_TALLER.

---

## MÓDULO: SERVICE ORDERS

### Base URL: `/service-orders`

---

#### `POST /service-orders`
**Rol:** ASESOR, LIDER_TECNICO  
**Pantalla:** Móvil → Accesorización → botón Generar OT  
**Prerrequisito:** `vehicle.status === DOCUMENTADO`

**Body:**
```json
{ "vehicleId": "abc123" }
```

**Lógica interna:**
1. Extraer accesorios VENDIDOS y OBSEQUIADOS de la documentación
2. Generar número de orden: `ORD-SURMOTOR-20260223-001`
3. Ejecutar algoritmo de predicción
4. Crear documento en `serviceOrders/{id}`
5. Actualizar vehicle: status → ORDEN_GENERADA
6. Registrar en statusHistory
7. FCM a LIDER_TECNICO de la sede (OT_GENERADA)

**Response 201:**
```json
{
  "orderId": "ord123",
  "orderNumber": "ORD-SURMOTOR-20260223-001",
  "accessories": [...],
  "predictions": [
    { "key": "alarma", "probability": 75, "reason": "El 75% de clientes con láminas y aros también compran alarma" }
  ]
}
```

---

#### `GET /service-orders`
**Rol:** ASESOR, LIDER_TECNICO, PERSONAL_TALLER, JEFE_TALLER  
**Pantalla:** Móvil → Accesorización

**Query params:**
```
?sede=SURMOTOR
&status=GENERADA,ASIGNADA
&vehicleId=abc123
```

---

#### `GET /service-orders/:id`
**Rol:** Todos  
**Pantalla:** Detalle OT con checklist y predicciones

---

#### `PATCH /service-orders/:id/assign`
**Rol:** LIDER_TECNICO (EXCLUSIVO)  
**Pantalla:** Móvil → Accesorización → pantalla OT → selector de técnico

**Body:**
```json
{ "technicianId": "uid-tecnico", "technicianName": "Carlos López" }
```

**Lógica:** Actualiza OT con técnico, vehicle → ASIGNADO, registra statusHistory. FCM a técnico (TECNICO_ASIGNADO).

---

#### `PATCH /service-orders/:id/checklist`
**Rol:** PERSONAL_TALLER (solo si es el técnico asignado)  
**Pantalla:** Móvil → Instalación → checklist

**Body:**
```json
{
  "accessoryKey": "aros",
  "installed": true
}
```

**Lógica:** Si `vehicle.status !== EN_INSTALACION` → cambia a EN_INSTALACION. Al marcar el último accesorio → INSTALACION_COMPLETA. FCM a LIDER_TECNICO.

---

#### `PATCH /service-orders/:id/ready-for-delivery`
**Rol:** LIDER_TECNICO  
**Pantalla:** Móvil → Accesorización → botón "Listo para Entrega"

**Lógica:** vehicle → LISTO_PARA_ENTREGA. FCM a ASESOR de la sede.

---

#### `POST /service-orders/reopen`
**Rol:** ASESOR, LIDER_TECNICO  
**Pantalla:** Móvil → Accesorización → Reaperturas → formulario  
**Prerrequisito:** `status === EN_INSTALACION || LISTO_PARA_ENTREGA`

**Body:**
```json
{
  "vehicleId": "abc123",
  "newAccessories": ["alarma", "sensores"],
  "reason": "Cliente decidió agregar alarma y sensores"
}
```

**Lógica:** Crea nueva OT con `isReopening: true`, vehicle → REAPERTURA_OT. FCM a JEFE_TALLER y LIDER_TECNICO.

---

#### `GET /service-orders/predictions/:vehicleId`
**Rol:** ASESOR, LIDER_TECNICO  
**Pantalla:** Móvil → Accesorización → detalle OT → sección predicciones

---

## MÓDULO: APPOINTMENTS

### Base URL: `/appointments`

---

#### `POST /appointments`
**Rol:** ASESOR, LIDER_TECNICO, JEFE_TALLER  
**Pantalla:** Móvil → Agendamiento → formulario  
**Prerrequisito:** `vehicle.status === LISTO_PARA_ENTREGA`

**Body:**
```json
{
  "vehicleId": "abc123",
  "scheduledDate": "2026-02-25",
  "scheduledTime": "10:00",
  "assignedAdvisorId": "uid-asesor",
  "assignedAdvisorName": "Juan Pérez"
}
```

**Lógica:** Crea appointment, vehicle → AGENDADO. FCM a asesor asignado y JEFE_TALLER.

---

#### `GET /appointments`
**Rol:** ASESOR, LIDER_TECNICO, JEFE_TALLER  
**Pantalla:** Móvil/Web → Agendamiento → calendario

**Query params:**
```
?sede=SURMOTOR
&dateFrom=2026-02-01
&dateTo=2026-02-28
```

**Response 200:**
```json
[
  {
    "id": "apt123",
    "vehicleId": "abc123",
    "chassis": "9BFPK...",
    "model": "Sportage",
    "scheduledDate": "2026-02-25",
    "scheduledTime": "10:00",
    "assignedAdvisorName": "Juan Pérez",
    "status": "AGENDADO"
  }
]
```

---

#### `PATCH /appointments/:id`
**Rol:** ASESOR, LIDER_TECNICO, JEFE_TALLER  
**Pantalla:** Reagendar o cambiar asesor

**Body:**
```json
{
  "scheduledDate": "2026-02-26",
  "scheduledTime": "11:00",
  "assignedAdvisorId": "uid-otro-asesor"
}
```

---

## MÓDULO: DELIVERY

### Base URL: `/delivery`

---

#### `POST /delivery/ceremony/:vehicleId`
**Rol:** ASESOR (solo si es el asignado en el appointment)  
**Pantalla:** Móvil → Agendamiento → pantalla de ceremonia

**Body (multipart/form-data):**
```
deliveryPhoto: [imagen]
signedActa: [imagen]
clientComment: "Excelente atención, muy satisfecho"
appointmentId: "apt123"
```

**Lógica:**
1. Subir fotos a Storage: `vehicles/{id}/delivery/`
2. Crear documento en `deliveryCeremonies/{vehicleId}`
3. Actualizar vehicle: status → ENTREGADO, deliveryDate, deliveredBy
4. Registrar en statusHistory
5. FCM a JEFE_TALLER

**Response 201:**
```json
{
  "vehicleId": "abc123",
  "newStatus": "Entregado",
  "deliveryDate": "2026-02-25T10:30:00Z"
}
```

---

#### `GET /delivery/ceremony/:vehicleId`
**Rol:** JEFE_TALLER, ASESOR (si es el entregador)  
**Pantalla:** Stock → detalle → tab Entrega

---

## MÓDULO: USERS

### Base URL: `/users`

---

#### `POST /users`
**Rol:** JEFE_TALLER  
**Pantalla:** Web/Móvil → Gestión de Usuarios → crear

**Body:**
```json
{
  "displayName": "Carlos López",
  "email": "carlos@kia.com",
  "role": "PERSONAL_TALLER",
  "sede": "SURMOTOR"
}
```

**Lógica:**
1. Firebase Admin SDK: `createUser({ email, displayName })`
2. Asignar custom claims: `{ role, sede, active: true }`
3. Crear documento en `users/{uid}`
4. Enviar email con contraseña temporal

---

#### `GET /users`
**Rol:** JEFE_TALLER, LIDER_TECNICO (para filtrar técnicos activos)  
**Query:** `?role=PERSONAL_TALLER&sede=SURMOTOR&active=true`

---

#### `PATCH /users/:uid`
**Rol:** JEFE_TALLER  
**Pantalla:** Gestión de Usuarios → editar

**Body:** Cualquier campo editable (displayName, role, sede, active)

**Lógica:** Actualiza Firestore + actualiza custom claims via Admin SDK.

---

#### `DELETE /users/:uid`
**Rol:** JEFE_TALLER  
**Pantalla:** Gestión de Usuarios → eliminar

**Lógica:** `active: false` en claims + marca inactivo en Firestore (borrado lógico).

---

#### `POST /users/:uid/reset-password`
**Rol:** JEFE_TALLER  
**Pantalla:** Gestión de Usuarios → reset contraseña

**Lógica:** `admin.auth().generatePasswordResetLink(email)` → enviar email.

---

#### `POST /users/fcm-token`
**Rol:** Todos  
**Pantalla:** Llamado automático al iniciar la app

**Body:**
```json
{ "token": "fcm-device-token-aqui" }
```

---

## MÓDULO: CATALOGS

### Base URL: `/catalogs`

---

#### `GET /catalogs/colors`
#### `POST /catalogs/colors` (Rol: JEFE_TALLER, DOCUMENTACION)
#### `DELETE /catalogs/colors/:id` (Rol: JEFE_TALLER, DOCUMENTACION)

#### `GET /catalogs/models`
#### `POST /catalogs/models` (Rol: JEFE_TALLER)
#### `DELETE /catalogs/models/:id` (Rol: JEFE_TALLER)

#### `GET /catalogs/concessionaires`
#### `POST /catalogs/concessionaires` (Rol: JEFE_TALLER, DOCUMENTACION)
#### `PATCH /catalogs/concessionaires/:id` (Rol: JEFE_TALLER, DOCUMENTACION)
#### `DELETE /catalogs/concessionaires/:id` (Rol: JEFE_TALLER)

#### `GET /catalogs/sedes`
#### `POST /catalogs/sedes` (Rol: JEFE_TALLER)

**Nota:** Los catálogos se cachean en el cliente al iniciar sesión. Se refrescan cuando el servidor indica cambios vía notificación o al reabrir la app.

---

## MÓDULO: REPORTS

### Base URL: `/reports`

---

#### `GET /reports/vehicle/:vehicleId`
**Rol:** JEFE_TALLER, ASESOR, LIDER_TECNICO  
**Pantalla:** Detalle vehículo → botón "Generar Reporte"

**Response:** PDF binario con trazabilidad completa del vehículo  
**Headers:** `Content-Type: application/pdf`

---

#### `GET /reports/analytics`
**Rol:** JEFE_TALLER  
**Pantalla:** Web → Dashboard Inicio / Reportes

**Query:**
```
?sede=ALL
&dateFrom=2026-01-01
&dateTo=2026-02-28
&groupBy=month
```

**Response 200:**
```json
{
  "vehiclesIngested": { "byDay": [...], "byMonth": [...] },
  "vehiclesDelivered": { "byDay": [...], "byMonth": [...] },
  "topAdvisors": [
    { "name": "Juan", "ordersGenerated": 45, "deliveries": 38 }
  ],
  "accessoriesByModel": [...],
  "telemetryCount": 23
}
```

---

#### `GET /reports/technician-performance/:uid`
**Rol:** PERSONAL_TALLER (propio uid), JEFE_TALLER  
**Pantalla:** Móvil Personal Taller → Reporte personal

**Response 200:**
```json
{
  "totalInstalled": 32,
  "pending": 5,
  "avgInstallationTime": "2h 15m",
  "byMonth": [...]
}
```

---

## MÓDULO: NOTIFICATIONS

### Base URL: `/notifications`

---

#### `GET /notifications`
**Rol:** Todos  
**Pantalla:** Header → ícono de notificaciones → panel lateral

**Query:** `?read=false&limit=20`

---

#### `PATCH /notifications/:id/read`
**Rol:** Todos  
**Pantalla:** Marcar notificación como leída