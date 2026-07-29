# 📋 PLAN DE IMPLEMENTACIÓN — KIA DEALER MANAGEMENT SYSTEM

## Visión General

Sistema de gestión de vehículos para el concesionario KIA con 3 sedes (SurMotor, Shyris, Granadas-Centenos). Cubre el ciclo completo: ingreso → certificación → documentación → accesorización → entrega.

**Stack definitivo:**
- Backend: NestJS + TypeScript
- Base de datos: Firebase Firestore
- Auth: Firebase Authentication (Custom Claims para roles)
- Almacenamiento: Firebase Storage
- Notificaciones: Firebase Cloud Messaging (FCM)
- Web: Next.js 14 (App Router)
- Móvil: React Native + Expo SDK 51+

---

## Estructura de Colecciones Firestore

```
firestore/
├── vehicles/{vehicleId}
│   └── statusHistory/{historyId}       ← Subcolección de trazabilidad
├── certifications/{vehicleId}          ← 1:1 con vehicle
├── documentations/{vehicleId}          ← 1:1 con vehicle
├── serviceOrders/{orderId}
├── appointments/{appointmentId}
├── deliveryCeremonies/{vehicleId}      ← 1:1 con vehicle
├── users/{uid}
├── notifications/{notificationId}
└── catalogs/
    ├── colors/{colorId}
    ├── concessionaires/{id}
    ├── models/{modelId}
    ├── sedes/{sedeId}
    └── accessories/{accessoryId}
```

### Custom Claims Firebase Auth

```json
{
  "role": "JEFE_TALLER | ASESOR | LIDER_TECNICO | PERSONAL_TALLER | DOCUMENTACION",
  "sede": "SURMOTOR | SHYRIS | GRANADAS_CENTENOS | ALL",
  "active": true
}
```

---

## Estructura del Monorepo

```
kia-dealer/
├── backend/               # NestJS
│   └── src/
│       ├── modules/
│       │   ├── vehicles/
│       │   ├── certifications/
│       │   ├── documentation/
│       │   ├── service-orders/
│       │   ├── appointments/
│       │   ├── delivery/
│       │   ├── users/
│       │   ├── notifications/
│       │   ├── catalogs/
│       │   └── reports/
│       └── shared/
│           ├── guards/          # FirebaseAuthGuard, RolesGuard
│           ├── decorators/
│           └── firebase/        # Admin SDK config
├── web/                   # Next.js
│   └── src/
│       ├── app/
│       ├── components/
│       ├── hooks/
│       └── lib/           # Firebase client SDK
├── mobile/                # React Native + Expo
│   └── src/
│       ├── screens/
│       ├── navigation/
│       ├── components/
│       └── services/
└── shared/                # Tipos TypeScript compartidos
    ├── enums/
    ├── interfaces/
    └── dtos/
```

---

## Fases de Implementación

### FASE 0 — Infraestructura Base (1 semana)

- Crear proyecto Firebase (`kia-dealer-prod`)
- Habilitar Auth (Email/Password), Firestore, Storage, FCM
- Definir reglas de seguridad Firestore por rol
- Configurar Firebase Admin SDK en NestJS
- Implementar `FirebaseAuthGuard` y `RolesGuard`
- Setup monorepo con tipos compartidos
- Crear entornos: development / staging / production

### FASE 1 — Backend Ingreso y Certificación (1.5 semanas)

- Módulo `vehicles`: CRUD + cambio de estado centralizado
- Módulo `certifications`: CRUD certificación interna/externa
- Módulo `catalogs`: CRUD colores, sedes, concesionarios, modelos
- `StatusHistoryService`: registrar cada cambio de estado en subcolección
- Upload foto vehículo y foto aros a Firebase Storage
- Validación: año >= año actual, chasis único
- Guards por rol en cada endpoint

### FASE 2 — Backend Documentación (1 semana)

- Módulo `documentation`: asociar cliente, clasificar accesorios
- Upload PDFs a Firebase Storage (factura, correo, factura accesorios)
- Lógica DOCUMENTACION_PENDIENTE vs DOCUMENTADO
- Endpoints cambio de sede y cesión a concesionario externo
- Trigger de notificación FCM al documentar

### FASE 3 — Backend Accesorización (1.5 semanas)

- Módulo `service-orders`: generación y gestión de OT
- Algoritmo de predicción de accesorios (análisis de patrones históricos)
- Asignación de técnico por Líder Técnico (filtro por sede y `active: true`)
- Checklist de instalación por técnico de taller
- Módulo `reopening`: endpoints de reapertura de OT
- Notificaciones FCM en cada cambio de estado

### FASE 4 — Backend Entrega (0.5 semanas)

- Módulo `appointments`: CRUD agendamiento (fecha, hora, asesor)
- Módulo `delivery`: ceremonia (foto entrega, foto acta, comentario cliente)
- Upload fotos y acta a Firebase Storage
- Estado final ENTREGADO + registro en statusHistory

### FASE 5 — Backend Notificaciones y Reportes (1 semana)

- `NotificationsService`: FCM centralizado con triggers por evento
- Módulo `reports`: generación de PDF de trazabilidad con `pdfkit`
- Módulo `analytics`: KPIs para dashboard (agrupaciones por sede, asesor, estado)
- Módulo `users`: CRUD usuarios (Firebase Auth Admin + Firestore)

### FASE 6 — Web: Personal de Documentación (1.5 semanas)

- Setup Next.js + Firebase Client SDK
- Auth con redirección por rol (middleware de Next.js)
- Layout con sidebar desplegable derecha
- Pantallas: Inicio, Stock, Documentación, Cambio de Sede, Cambio de Concesionario
- Visor de PDFs con `react-pdf`
- Sistema de notificaciones en header (FCM web push)

### FASE 7 — Web: Jefe de Taller (1.5 semanas)

- Dashboard KPIs con `recharts`
- Stock CRUD completo (super usuario)
- Agendamiento con calendario
- Reportes con trazabilidad y exportación PDF
- Gestión de usuarios (CRUD Firebase Auth Admin via backend)
- Gestión de información (catálogos maestros)

### FASE 8 — Móvil: Asesor y Líder Técnico (2 semanas)

- Setup Expo + Firebase Client SDK
- Auth móvil + navegación por roles
- Tab Navigator inferior + Stack Navigator
- Pantallas: Inicio, Stock, Accesorización, Agendamiento
- `expo-camera` para fotos
- `expo-barcode-scanner` para QR del chasis
- `expo-notifications` para push

### FASE 9 — Móvil: Personal de Taller y Jefe de Taller (1.5 semanas)

- Personal de Taller: Inicio, Stock, Instalación (checklist), Reporte personal
- Jefe de Taller: Inicio (KPIs avanzados), Stock, Agendamiento, Gestión de Usuarios
- Menú inferior diferenciado por rol mediante custom claims

### FASE 10 — QA y Despliegue (1 semana)

- Pruebas end-to-end por flujo completo
- Reglas de seguridad Firestore en producción
- Despliegue backend: Cloud Run o Railway
- Despliegue web: Vercel
- Build móvil: EAS Build (iOS + Android)
- Monitoreo: Firebase Crashlytics (móvil) + Sentry (web/backend)

---

## Resumen de Tiempos

| Fase | Descripción | Semanas |
|------|-------------|---------|
| 0 | Infraestructura | 1 |
| 1 | Backend Ingreso/Certificación | 1.5 |
| 2 | Backend Documentación | 1 |
| 3 | Backend Accesorización | 1.5 |
| 4 | Backend Entrega | 0.5 |
| 5 | Notificaciones y Reportes | 1 |
| 6 | Web Documentación | 1.5 |
| 7 | Web Jefe de Taller | 1.5 |
| 8 | Móvil Asesor/Líder | 2 |
| 9 | Móvil Taller/Jefe | 1.5 |
| 10 | QA y Despliegue | 1 |
| **TOTAL** | | **~14 semanas** |

---

## Reglas Críticas para el Agente de IA

1. **El estado del vehículo es la fuente de verdad.** Todo cambio pasa por `VehicleStatusService` que actualiza el campo `status` y crea un documento en la subcolección `statusHistory`.
2. **Firebase Auth Custom Claims = control de acceso.** El backend extrae `role` y `sede` del JWT en cada request. Los guards aplican antes del controller.
3. **Firestore es la base de datos principal.** No hay SQL. Referencias por document ID.
4. **Firebase Storage para todos los archivos.** El backend genera URLs firmadas. El frontend nunca sube directo a Storage.
5. **Las notificaciones FCM se disparan en el backend**, no en el frontend.
6. **El algoritmo de predicción** analiza patrones históricos de clasificación de accesorios en la colección `vehicles`.
7. **Tipos compartidos en `/shared`** deben usarse en backend, web y móvil para garantizar consistencia de DTOs e interfaces.