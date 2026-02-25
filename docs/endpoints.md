# KIA Dealer Management API — Referencia de Endpoints

> Base URL: `http://localhost:3000`
> Swagger UI: `http://localhost:3000/api`
> Autenticación: **Bearer Token** (Firebase ID Token) en todos los endpoints salvo `/auth/login` y `/seed/run`.

---

## Roles del sistema

| Código | Descripción |
|---|---|
| `JEFE_TALLER` | Acceso total a todas las sedes y operaciones |
| `LIDER_TECNICO` | Gestión de órdenes de trabajo y técnicos en su sede |
| `ASESOR` | Recepción de vehículos, agendamiento y entregas en su sede |
| `PERSONAL_TALLER` | Ejecución de instalaciones (checklist) |
| `DOCUMENTACION` | Registro de documentación, cambio de sede y cesiones |

---

## Sedes (`SedeEnum`)

`SURMOTOR` · `SHYRIS` · `GRANADAS_CENTENOS` · `ALL` (solo JEFE_TALLER)

---

## 0. Auth `/auth`

> ⚠️ Único endpoint **público** (no requiere Bearer Token). Úsalo para obtener el `idToken` que se envía como `Authorization: Bearer <idToken>` en todas las demás peticiones.

| Método | Ruta | Descripción | Autenticación |
|---|---|---|---|
| `POST` | `/auth/login` | Login con email y contraseña. Retorna `idToken`, `refreshToken` y perfil del usuario. | Sin Bearer |

### Body — `POST /auth/login`

```json
{
  "email": "jefe.taller@kiadealer.com",
  "password": "KiaDealer2024!"
}
```

### Respuesta exitosa `200`

```json
{
  "idToken": "eyJhbG...",
  "refreshToken": "AMf-vB...",
  "expiresIn": 3600,
  "user": {
    "uid": "abc123",
    "email": "jefe.taller@kiadealer.com",
    "displayName": "Carlos Mendoza (Jefe Taller)",
    "role": "JEFE_TALLER",
    "sede": "ALL",
    "active": true
  }
}
```

| Campo | Descripción |
|---|---|
| `idToken` | JWT de Firebase Auth. Válido **1 hora** (3600 s). Usar como `Bearer` en todas las demás peticiones. |
| `refreshToken` | Token para renovar el `idToken` sin re-autenticar (Firebase REST API). |
| `expiresIn` | Segundos hasta la expiración del `idToken`. |
| `user` | Perfil del usuario con rol y sede — leer para adaptar la UI. |

### Errores posibles

| HTTP | Mensaje | Causa |
|---|---|---|
| `401` | `No existe una cuenta con ese email.` | Email incorrecto |
| `401` | `Contraseña incorrecta.` | Password incorrecto |
| `401` | `Usuario inactivo. Contacte al administrador.` | Cuenta deshabilitada |
| `401` | `Demasiados intentos fallidos. Intente más tarde.` | Rate-limit Firebase |

---

## 1. Vehicles `/vehicles`

| Método | Ruta | Descripción | Roles permitidos |
|---|---|---|---|
| `POST` | `/vehicles` | Ingresar vehículo al taller (multipart o JSON) | ASESOR, LIDER_TECNICO, PERSONAL_TALLER, JEFE_TALLER |
| `GET` | `/vehicles` | Listar vehículos con filtros y paginación | Todos |
| `GET` | `/vehicles/:id` | Detalle de vehículo (incluye certificación y documentación) | Todos |
| `GET` | `/vehicles/:id/status-history` | Historial de estados del vehículo | Todos |
| `GET` | `/vehicles/stats/by-sede` | KPIs por sede | JEFE_TALLER |
| `GET` | `/vehicles/stats/today-deliveries` | Entregas agendadas para hoy | ASESOR, LIDER_TECNICO, JEFE_TALLER |
| `PATCH` | `/vehicles/:id` | Editar datos del vehículo | JEFE_TALLER |
| `DELETE` | `/vehicles/:id` | Eliminar vehículo | JEFE_TALLER |

### Query params — `GET /vehicles`

| Parámetro | Tipo | Descripción |
|---|---|---|
| `sede` | `SedeEnum` | Filtra por sede. Cualquier rol puede pasar este parámetro para ver stock de otra sede. Sin sede, el usuario ve la propia (JEFE_TALLER ve todo). |
| `status` | `string` | Estado(s) separados por coma. Ej: `Recepcionado en Taller,Documentado` |
| `chassis` | `string` | Búsqueda parcial por número de chasis |
| `clientId` | `string` | Búsqueda exacta por cédula del cliente |
| `page` | `number` | Página (default: `1`) |
| `limit` | `number` | Resultados por página (default: `20`, máx: `100`) |

---

## 2. Certifications `/certifications`

| Método | Ruta | Descripción | Roles permitidos |
|---|---|---|---|
| `POST` | `/certifications/:vehicleId` | Registrar certificación interna/externa del vehículo (multipart o JSON) | ASESOR, LIDER_TECNICO, PERSONAL_TALLER, JEFE_TALLER |
| `GET` | `/certifications/:vehicleId` | Obtener certificación de un vehículo | Todos |
| `PATCH` | `/certifications/:vehicleId` | Editar certificación | JEFE_TALLER |

---

## 3. Documentation `/documentation`

| Método | Ruta | Descripción | Roles permitidos |
|---|---|---|---|
| `POST` | `/documentation/:vehicleId` | Registrar documentación del vehículo (multipart o JSON) | DOCUMENTACION, JEFE_TALLER |
| `GET` | `/documentation/:vehicleId` | Obtener documentación del vehículo | DOCUMENTACION, JEFE_TALLER |
| `PATCH` | `/documentation/:vehicleId` | Editar documentación | DOCUMENTACION, JEFE_TALLER |
| `PATCH` | `/documentation/:vehicleId/sede` | Cambio de sede del vehículo | DOCUMENTACION, JEFE_TALLER |
| `PATCH` | `/documentation/:vehicleId/transfer` | Ceder vehículo a otro concesionario (multipart) | DOCUMENTACION, JEFE_TALLER |

### Archivos aceptados — `POST /documentation/:vehicleId`

| Campo | Descripción |
|---|---|
| `vehicleInvoice` | Factura del vehículo |
| `giftEmail` | Email de obsequio |
| `accessoryInvoice` | Factura de accesorios |

---

## 4. Service Orders `/service-orders`

| Método | Ruta | Descripción | Roles permitidos |
|---|---|---|---|
| `POST` | `/service-orders` | Generar Orden de Trabajo | ASESOR, LIDER_TECNICO, JEFE_TALLER |
| `POST` | `/service-orders/reopen` | Reabrir Orden de Trabajo | ASESOR, LIDER_TECNICO, JEFE_TALLER |
| `GET` | `/service-orders` | Listar órdenes de trabajo | Todos |
| `GET` | `/service-orders/:id` | Detalle de orden de trabajo | Todos |
| `GET` | `/service-orders/predictions/:vehicleId` | Predicciones de accesorios para un vehículo | ASESOR, LIDER_TECNICO, JEFE_TALLER |
| `PATCH` | `/service-orders/:id/assign` | Asignar técnico a la OT | LIDER_TECNICO, JEFE_TALLER |
| `PATCH` | `/service-orders/:id/checklist` | Actualizar checklist de instalación | PERSONAL_TALLER, JEFE_TALLER |
| `PATCH` | `/service-orders/:id/ready-for-delivery` | Marcar vehículo listo para entrega | LIDER_TECNICO, JEFE_TALLER |

### Query params — `GET /service-orders`

| Parámetro | Tipo | Descripción |
|---|---|---|
| `sede` | `string` | Filtrar por sede |
| `status` | `string` | Filtrar por estado de la OT |
| `vehicleId` | `string` | Filtrar por vehículo específico |

---

## 5. Appointments `/appointments`

| Método | Ruta | Descripción | Roles permitidos |
|---|---|---|---|
| `POST` | `/appointments` | Agendar entrega de vehículo | ASESOR, LIDER_TECNICO, JEFE_TALLER |
| `GET` | `/appointments` | Listar agendamientos | ASESOR, LIDER_TECNICO, JEFE_TALLER |
| `PATCH` | `/appointments/:id` | Actualizar / reagendar | ASESOR, LIDER_TECNICO, JEFE_TALLER |

### Query params — `GET /appointments`

| Parámetro | Tipo | Descripción |
|---|---|---|
| `dateFrom` | `string` | Fecha inicio (YYYY-MM-DD) |
| `dateTo` | `string` | Fecha fin (YYYY-MM-DD) |

---

## 6. Delivery `/delivery`

| Método | Ruta | Descripción | Roles permitidos |
|---|---|---|---|
| `POST` | `/delivery/ceremony/:vehicleId` | Ejecutar ceremonia de entrega (multipart o JSON) | ASESOR, JEFE_TALLER |
| `GET` | `/delivery/ceremony/:vehicleId` | Obtener ceremonia de entrega | ASESOR, JEFE_TALLER |

### Archivos aceptados — `POST /delivery/ceremony/:vehicleId`

| Campo | Descripción |
|---|---|
| `deliveryPhoto` | Foto de la entrega |
| `signedActa` | Acta firmada |

---

## 7. Users `/users`

| Método | Ruta | Descripción | Roles permitidos |
|---|---|---|---|
| `POST` | `/users` | Crear usuario en Firebase Auth + Firestore | JEFE_TALLER |
| `POST` | `/users/fcm-token` | Registrar / actualizar FCM token del dispositivo | Todos |
| `POST` | `/users/:uid/reset-password` | Enviar link de reset de contraseña | JEFE_TALLER |
| `GET` | `/users` | Listar usuarios | JEFE_TALLER, LIDER_TECNICO |
| `GET` | `/users/:uid` | Obtener usuario por UID | JEFE_TALLER |
| `PATCH` | `/users/:uid` | Editar usuario | JEFE_TALLER |
| `DELETE` | `/users/:uid` | Desactivar usuario (borrado lógico) | JEFE_TALLER |

### Query params — `GET /users`

| Parámetro | Tipo | Descripción |
|---|---|---|
| `role` | `RoleEnum` | Filtrar por rol |
| `sede` | `SedeEnum` | Filtrar por sede |
| `active` | `boolean` | Filtrar por estado activo/inactivo |

---

## 8. Catalogs `/catalogs`

> Los catálogos de lectura (`GET`) no requieren rol específico.

| Método | Ruta | Descripción | Roles permitidos |
|---|---|---|---|
| `GET` | `/catalogs/colors` | Listar colores | Todos |
| `POST` | `/catalogs/colors` | Crear color | JEFE_TALLER, DOCUMENTACION |
| `DELETE` | `/catalogs/colors/:id` | Eliminar color | JEFE_TALLER, DOCUMENTACION |
| `GET` | `/catalogs/models` | Listar modelos de vehículo | Todos |
| `POST` | `/catalogs/models` | Crear modelo | JEFE_TALLER |
| `DELETE` | `/catalogs/models/:id` | Eliminar modelo | JEFE_TALLER |
| `GET` | `/catalogs/concessionaires` | Listar concesionarios | Todos |
| `POST` | `/catalogs/concessionaires` | Crear concesionario | JEFE_TALLER, DOCUMENTACION |
| `PATCH` | `/catalogs/concessionaires/:id` | Editar concesionario | JEFE_TALLER, DOCUMENTACION |
| `DELETE` | `/catalogs/concessionaires/:id` | Eliminar concesionario | JEFE_TALLER |
| `GET` | `/catalogs/sedes` | Listar sedes | Todos |
| `POST` | `/catalogs/sedes` | Crear sede | JEFE_TALLER |

---

## 9. Notifications `/notifications`

| Método | Ruta | Descripción | Roles permitidos |
|---|---|---|---|
| `GET` | `/notifications` | Listar notificaciones del usuario autenticado | Todos |
| `PATCH` | `/notifications/:id/read` | Marcar notificación como leída | Todos |

### Query params — `GET /notifications`

| Parámetro | Tipo | Descripción |
|---|---|---|
| `read` | `boolean` | `false` = solo no leídas |
| `limit` | `number` | Cantidad máxima (default: `20`) |

---

## 10. Reports `/reports`

| Método | Ruta | Descripción | Roles permitidos |
|---|---|---|---|
| `GET` | `/reports/vehicle/:vehicleId` | Generar PDF de trazabilidad del vehículo | JEFE_TALLER, ASESOR, LIDER_TECNICO |
| `GET` | `/reports/analytics` | Analytics y KPIs globales | JEFE_TALLER |
| `GET` | `/reports/technician-performance/:uid` | Rendimiento de un técnico | PERSONAL_TALLER, JEFE_TALLER |

### Query params — `GET /reports/analytics`

| Parámetro | Tipo | Descripción |
|---|---|---|
| `sede` | `string` | Filtrar por sede |
| `dateFrom` | `string` | Fecha inicio (YYYY-MM-DD) |
| `dateTo` | `string` | Fecha fin (YYYY-MM-DD) |

---

## 11. Seed `/seed`

> ⚠️ Solo para desarrollo y carga inicial de datos. Deshabilitar en producción.

| Método | Ruta | Descripción | Autenticación |
|---|---|---|---|
| `POST` | `/seed/run` | Ejecutar seed de base de datos | Sin Bearer — requiere `secretKey` en el body |

### Body — `POST /seed/run`

```json
{
  "secretKey": "tu_clave_secreta_aqui",
  "clear": false
}
```

| Campo | Tipo | Descripción |
|---|---|---|
| `secretKey` | `string` | Debe coincidir con `SEED_SECRET_KEY` en `.env` |
| `clear` | `boolean` | Si `true`, borra colecciones antes de insertar (destructivo) |

### Qué inserta el seed

| Sección | Datos |
|---|---|
| **Catálogos** | 8 colores, 10 modelos KIA, 3 concesionarios (uno por sede) |
| **Usuarios** | 14 usuarios en Firebase Auth + Firestore con roles y sedes asignados |
| **Vehículos** | 14 vehículos distribuidos en las 3 sedes, cubriendo todos los estados del flujo |

#### Credenciales de usuarios seed

| Email | Rol | Sede | Contraseña |
|---|---|---|---|
| `jefe.taller@kiadealer.com` | JEFE_TALLER | ALL | `KiaDealer2024!` |
| `lider.surmotor@kiadealer.com` | LIDER_TECNICO | SURMOTOR | `KiaDealer2024!` |
| `lider.shyris@kiadealer.com` | LIDER_TECNICO | SHYRIS | `KiaDealer2024!` |
| `lider.granadas@kiadealer.com` | LIDER_TECNICO | GRANADAS_CENTENOS | `KiaDealer2024!` |
| `asesor.surmotor@kiadealer.com` | ASESOR | SURMOTOR | `KiaDealer2024!` |
| `asesor.shyris@kiadealer.com` | ASESOR | SHYRIS | `KiaDealer2024!` |
| `asesor.granadas@kiadealer.com` | ASESOR | GRANADAS_CENTENOS | `KiaDealer2024!` |
| `taller1.surmotor@kiadealer.com` | PERSONAL_TALLER | SURMOTOR | `KiaDealer2024!` |
| `taller2.surmotor@kiadealer.com` | PERSONAL_TALLER | SURMOTOR | `KiaDealer2024!` |
| `taller1.shyris@kiadealer.com` | PERSONAL_TALLER | SHYRIS | `KiaDealer2024!` |
| `taller1.granadas@kiadealer.com` | PERSONAL_TALLER | GRANADAS_CENTENOS | `KiaDealer2024!` |
| `docs.surmotor@kiadealer.com` | DOCUMENTACION | SURMOTOR | `KiaDealer2024!` |
| `docs.shyris@kiadealer.com` | DOCUMENTACION | SHYRIS | `KiaDealer2024!` |
| `docs.granadas@kiadealer.com` | DOCUMENTACION | GRANADAS_CENTENOS | `KiaDealer2024!` |

---

## Flujo de estados de un vehículo

```
RECEPCIONADO
    └─► CERTIFICADO_STOCK          (Certifications)
            └─► DOCUMENTACIÓN_PENDIENTE → DOCUMENTADO    (Documentation)
                    └─► ORDEN_GENERADA                   (Service Orders)
                            └─► ASIGNADO
                                    └─► EN_INSTALACION
                                            └─► INSTALACION_COMPLETA
                                                    └─► LISTO_PARA_ENTREGA
                                                            └─► AGENDADO     (Appointments)
                                                                    └─► ENTREGADO    (Delivery)

Estados de excepción:
  REAPERTURA_OT → puede volver al flujo de OT
  CEDIDO        → vehículo transferido a otro concesionario
```

---

## Variables de entorno requeridas (`.env`)

| Variable | Descripción |
|---|---|
| `PORT` | Puerto del servidor (default: `3000`) |
| `FIREBASE_PROJECT_ID` | ID del proyecto Firebase |
| `FIREBASE_CLIENT_EMAIL` | Email de la Service Account |
| `FIREBASE_PRIVATE_KEY` | Clave privada RSA (con `\n` escapados) |
| `FIREBASE_STORAGE_BUCKET` | Bucket de Storage (sin `gs://`) |
| `PREDICTION_THRESHOLD` | Umbral mínimo (0–100) para predicciones de accesorios |
| `FIREBASE_WEB_API_KEY` | Web API Key del proyecto Firebase (requerida por `/auth/login`) |
| `SEED_SECRET_KEY` | Clave para proteger el endpoint `/seed/run` |
| `NODE_ENV` | `development` / `production` |
