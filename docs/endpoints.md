# 📡 ENDPOINTS — KIA DEALER MANAGEMENT SYSTEM

**Base URL (producción):** `https://tu-app.onrender.com`  
**Base URL (local):** `http://localhost:3000`  
**Swagger UI:** `{BASE_URL}/api`  
**Auth:** Bearer Token (Firebase ID Token) — header `Authorization: Bearer <token>`

---

## 🔑 AUTH

| Método | Ruta | Descripción | Roles |
|--------|------|-------------|-------|
| POST | `/auth/login` | Verifica token Firebase y devuelve claims del usuario (rol, sede, uid) | Público |

```bash
curl -X POST http://localhost:3000/auth/login \
  -H "Authorization: Bearer <FIREBASE_ID_TOKEN>"
```

---

## 👤 USERS

| Método | Ruta | Descripción | Roles |
|--------|------|-------------|-------|
| POST | `/users` | Crear usuario (Firebase Auth + Firestore, asigna rol y sede) | JEFE_TALLER, SOPORTE |
| POST | `/users/fcm-token` | Registrar token FCM del dispositivo | Todos |
| GET | `/users` | Listar usuarios. Query: `?role=ASESOR&sede=X&active=true` | JEFE_TALLER, SOPORTE |
| GET | `/users/:uid` | Detalle de usuario | JEFE_TALLER, SOPORTE |
| PATCH | `/users/:uid` | Editar usuario (nombre, rol, sede, activo) | JEFE_TALLER, SOPORTE |
| DELETE | `/users/:uid` | Eliminar de Firebase Auth + Firestore | JEFE_TALLER, SOPORTE |
| POST | `/users/:uid/reset-password` | Enviar email de reseteo | JEFE_TALLER, SOPORTE |

---

## 🚗 VEHICLES — Fase 1.1 Ingreso

| Método | Ruta | Descripción | Roles |
|--------|------|-------------|-------|
| POST | `/vehicles` | **Ingresar vehículo** → `RECEPCIONADO`. Sede del token. Acepta `multipart/form-data` (campo `photo`) o JSON con `photoBase64` | ASESOR, LIDER_TECNICO, PERSONAL_TALLER, JEFE_TALLER, SOPORTE |
| GET | `/vehicles` | Listar inventario activo. Query: `?chassis=9BFP&sede=X&status=AGENDADO&clientId=123&page=1&limit=20` | Todos |
| GET | `/vehicles/:id` | Detalle con certificación y documentación embebidas | Todos |
| GET | `/vehicles/:id/status-history` | **Historial completo de estados** ordenado cronológicamente | Todos |
| PATCH | `/vehicles/:id` | Editar campos del vehículo (corrección admin) | JEFE_TALLER, SOPORTE |
| DELETE | `/vehicles/:id` | Eliminar vehículo permanentemente | JEFE_TALLER, SOPORTE |
| GET | `/vehicles/stats/by-sede` | KPIs: conteo por sede y estado | JEFE_TALLER, SOPORTE |
| GET | `/vehicles/stats/today-deliveries` | Vehículos con `AGENDADO` para hoy | ASESOR, LIDER_TECNICO, JEFE_TALLER, SOPORTE |

### Query params de GET /vehicles
```
?chassis=9BFP                          busqueda parcial del chasis
?sede=SURMOTOR_NORTE                   filtrar por sede
?status=AGENDADO                       un estado exacto
?status=AGENDADO,LISTO_PARA_ENTREGA    multiples estados separados por coma
?status=ENTREGADO                      ver historial de entregados (terminal)
?clientId=1723456789                   filtrar por cedula de cliente
?page=1&limit=20                       paginacion
```
Sin ?sede: roles normales ven solo su sede. JEFE_TALLER/SOPORTE ven todo.  
Sin ?status: excluye CEDIDO y ENTREGADO (inventario activo).

---

## 🔍 CERTIFICATIONS — Fase 1.2

| Método | Ruta | Descripción | Roles |
|--------|------|-------------|-------|
| POST | `/certifications/:vehicleId` | **Certificar** → `CERTIFICADO_STOCK`. Acepta foto de aros. Dispara alertas KILOMETRAJE_ALTO / SIN_IMPRONTAS | ASESOR, LIDER_TECNICO, PERSONAL_TALLER, JEFE_TALLER, SOPORTE |
| GET | `/certifications/:vehicleId` | Obtener certificación | Todos |
| PATCH | `/certifications/:vehicleId` | Editar certificación existente | ASESOR, LIDER_TECNICO, PERSONAL_TALLER, JEFE_TALLER, SOPORTE |
| DELETE | `/certifications/:vehicleId` | Eliminar certificación | JEFE_TALLER, SOPORTE |

---

## 📄 DOCUMENTATION — Fase 2

| Método | Ruta | Descripción | Roles |
|--------|------|-------------|-------|
| POST | `/documentation/:vehicleId` | **Documentar** → `DOCUMENTADO` (o `DOCUMENTACION_PENDIENTE` si `saveAsPending:true`). Acepta PDFs multipart | DOCUMENTACION, JEFE_TALLER, SOPORTE |
| GET | `/documentation/:vehicleId` | Obtener documentación | Todos |
| PATCH | `/documentation/:vehicleId` | Editar documentacion (campos y/o PDFs individuales) | DOCUMENTACION, JEFE_TALLER, SOPORTE |
| DELETE | `/documentation/:vehicleId` | Eliminar documentación completa | JEFE_TALLER, SOPORTE |
| DELETE | `/documentation/:vehicleId/files/:fileType` | Eliminar un PDF. fileType: `invoiceUrl` / `giftEmailUrl` / `accessoryInvoiceUrl` | DOCUMENTACION, JEFE_TALLER, SOPORTE |
| PATCH | `/documentation/:vehicleId/sede` | **Cambio de sede** (Fase 2.2). Body: `{ newSede }`. Sin cambio de estado, registra statusHistory + notifica | DOCUMENTACION, JEFE_TALLER, SOPORTE |
| PATCH | `/documentation/:vehicleId/transfer` | **Cesion a concesionario** (Fase 2.3) → `CEDIDO` (estado terminal) | DOCUMENTACION, JEFE_TALLER, SOPORTE |

Campos multipart POST/PATCH /documentation:
```
invoiceFile          PDF factura del vehiculo
giftEmailFile        PDF correo de obsequio
accessoryInvoiceFile PDF factura de accesorios vendidos
(resto del body como text fields del form)
```

---

## 🔧 SERVICE-ORDERS — Fase 3

| Método | Ruta | Descripción | Roles |
|--------|------|-------------|-------|
| POST | `/service-orders` | **Generar OT** → `ORDEN_GENERADA`. Prerrequisito: `DOCUMENTADO`. Body: `{ vehicleId, orderNumber }` | ASESOR, LIDER_TECNICO, JEFE_TALLER, SOPORTE |
| GET | `/service-orders` | Listar OTs. Query: `?vehicleId=X&status=ASIGNADA&sede=X` | Todos |
| GET | `/service-orders/predictions/:vehicleId` | Predicciones de accesorios adicionales (algoritmo historico) | ASESOR, LIDER_TECNICO, JEFE_TALLER, SOPORTE |
| GET | `/service-orders/:id` | Detalle de OT con checklist | Todos |
| PATCH | `/service-orders/:id/assign` | **Asignar tecnico** → `ASIGNADO`. Body: `{ technicianUid, technicianName }`. Prerrequisito: `ORDEN_GENERADA` o `REAPERTURA_OT` | LIDER_TECNICO, JEFE_TALLER, SOPORTE |
| PATCH | `/service-orders/:id/checklist` | **Marcar accesorio** del checklist. Body: `{ accessoryKey, installed: true }`. Al completar todos → `INSTALACION_COMPLETA` automatico | PERSONAL_TALLER, JEFE_TALLER, SOPORTE |
| PATCH | `/service-orders/:id/ready-for-delivery` | **Aprobar listo para entrega** → `LISTO_PARA_ENTREGA`. Prerrequisito: `INSTALACION_COMPLETA` | LIDER_TECNICO, JEFE_TALLER, SOPORTE |
| POST | `/service-orders/reopen` | **Reapertura OT** → `REAPERTURA_OT`. Body: `{ vehicleId, newAccessories: [AccessoryKey], reason }` | ASESOR, LIDER_TECNICO, JEFE_TALLER, SOPORTE |

---

## 📅 APPOINTMENTS — Fase 4.1 Agendamiento

| Método | Ruta | Descripción | Roles |
|--------|------|-------------|-------|
| POST | `/appointments` | **Agendar entrega** → `AGENDADO`. Prerrequisito: `LISTO_PARA_ENTREGA` | ASESOR, LIDER_TECNICO, JEFE_TALLER, SOPORTE |
| GET | `/appointments` | Listar agendamientos. Query: `?vehicleId=X&date=2026-02-25&advisorUid=X` | Todos |
| PATCH | `/appointments/:id` | **Reagendar** (fecha / hora / asesor). Registra audit en statusHistory | ASESOR, LIDER_TECNICO, JEFE_TALLER, SOPORTE |

Body POST /appointments:
```json
{
  "vehicleId": "uuid-del-vehiculo",
  "scheduledDate": "2026-02-25",
  "scheduledTime": "10:00",
  "assignedAdvisorUid": "uid-firebase",
  "assignedAdvisorName": "Juan Perez"
}
```

---

## 🎉 DELIVERY — Fase 4.2 Ceremonia de Entrega

| Método | Ruta | Descripción | Roles |
|--------|------|-------------|-------|
| POST | `/delivery/ceremony/:vehicleId` | **Ejecutar ceremonia** → `ENTREGADO`. Solo el dia del agendamiento. Acepta fotos multipart | ASESOR, LIDER_TECNICO, JEFE_TALLER, SOPORTE |
| GET | `/delivery/ceremony/:vehicleId` | Obtener datos de entrega (fotos, fecha, asesor) | Todos |

Campos multipart POST /delivery/ceremony/:vehicleId:
```
vehiclePhoto    foto con el vehiculo (binary)
signedActaPhoto foto del acta firmada (binary)
clientComment   comentario del cliente (text field)
```

---

## 📋 CATALOGS — Datos maestros

| Método | Ruta | Descripción | Roles |
|--------|------|-------------|-------|
| GET | `/catalogs/colors` | Listar colores | Todos |
| POST | `/catalogs/colors` | Crear color. Body: `{ name }` → MAYUSCULAS | JEFE_TALLER, DOCUMENTACION, SOPORTE |
| DELETE | `/catalogs/colors/:id` | Eliminar color | JEFE_TALLER, SOPORTE |
| GET | `/catalogs/models` | Listar modelos | Todos |
| POST | `/catalogs/models` | Crear modelo | JEFE_TALLER, SOPORTE |
| DELETE | `/catalogs/models/:id` | Eliminar modelo | JEFE_TALLER, SOPORTE |
| GET | `/catalogs/concessionaires` | Listar concesionarios | Todos |
| POST | `/catalogs/concessionaires` | Crear concesionario | JEFE_TALLER, DOCUMENTACION, SOPORTE |
| PATCH | `/catalogs/concessionaires/:id` | Editar nombre | JEFE_TALLER, DOCUMENTACION, SOPORTE |
| DELETE | `/catalogs/concessionaires/:id` | Eliminar | JEFE_TALLER, SOPORTE |
| GET | `/catalogs/sedes` | Listar sedes | Todos |
| POST | `/catalogs/sedes` | Crear sede. Body: `{ name, code }` → MAYUSCULAS | JEFE_TALLER, SOPORTE |
| GET | `/catalogs/accessories` | Listar accesorios (`id`, `name`, `key`) | Todos |
| POST | `/catalogs/accessories` | Crear accesorio. Body: `{ name, key }` → MAYUSCULAS | JEFE_TALLER, SOPORTE |
| PATCH | `/catalogs/accessories/:id` | Editar nombre de accesorio | JEFE_TALLER, SOPORTE |
| DELETE | `/catalogs/accessories/:id` | Eliminar accesorio | JEFE_TALLER, SOPORTE |

---

## 📊 REPORTS

| Método | Ruta | Descripción | Roles |
|--------|------|-------------|-------|
| GET | `/reports/vehicle/:vehicleId` | Reporte completo del ciclo de vida del vehiculo | JEFE_TALLER, SOPORTE, DOCUMENTACION |
| GET | `/reports/analytics` | Analytics globales: tiempos por fase, volumen por sede. Query: `?sede=X&from=2026-01-01&to=2026-02-28` | JEFE_TALLER, SOPORTE |
| GET | `/reports/technician-performance/:uid` | Performance de tecnico (OTs, tiempo promedio) | JEFE_TALLER, SOPORTE |

---

## 🔁 Flujo secuencial de endpoints por vehiculo

```
1.  POST   /vehicles                                → RECEPCIONADO
2.  POST   /certifications/:vehicleId               → CERTIFICADO_STOCK
3.  POST   /documentation/:vehicleId                → DOCUMENTADO / DOCUMENTACION_PENDIENTE
    ├─     PATCH /documentation/:vehicleId/sede     → cambio de sede (sin cambio de estado)
    └─     PATCH /documentation/:vehicleId/transfer → CEDIDO (fin)
4.  POST   /service-orders                          → ORDEN_GENERADA
    └─     GET   /service-orders/predictions/:vid   → sugerencias ML
5.  PATCH  /service-orders/:id/assign               → ASIGNADA
6.  PATCH  /service-orders/:id/checklist (x N)      → EN_INSTALACION → INSTALACION_COMPLETA
    └─     POST  /service-orders/reopen             → REAPERTURA_OT → volver al paso 5
7.  PATCH  /service-orders/:id/ready-for-delivery   → LISTO_PARA_ENTREGA
8.  POST   /appointments                            → AGENDADO
    └─     PATCH /appointments/:id                  → reagendar
9.  POST   /delivery/ceremony/:vehicleId            → ENTREGADO

En cualquier momento:
    GET    /vehicles/:id/status-history             → trazabilidad completa
```

---

## 📌 Enums de referencia

### VehicleStatus
`RECEPCIONADO` · `CERTIFICADO_STOCK` · `DOCUMENTACION_PENDIENTE` · `DOCUMENTADO` · `ORDEN_GENERADA` · `ASIGNADO` · `EN_INSTALACION` · `INSTALACION_COMPLETA` · `REAPERTURA_OT` · `LISTO_PARA_ENTREGA` · `AGENDADO` · `ENTREGADO` · `CEDIDO`

### RoleEnum
`JEFE_TALLER` · `ASESOR` · `LIDER_TECNICO` · `PERSONAL_TALLER` · `DOCUMENTACION` · `SOPORTE`

### AccessoryKey (valores del enum)
`BOTON_ENCENDIDO` · `KIT_CARRETERA` · `AROS` · `LAMINAS` · `MOQUETAS` · `CUBREMALETAS` · `SEGURO` · `TELEMETRIA` · `SENSORES` · `ALARMA` · `NEBLINEROS` · `KIT_SEGURIDAD` · `PROTECTOR_CERAMICO` · `OTROS`

### AccessoryClassification
`VENDIDO` · `OBSEQUIADO` · `NO_APLICA`

### PaymentMethod
`CONTADO` · `CREDITO`
