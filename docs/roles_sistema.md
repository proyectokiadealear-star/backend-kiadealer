# 👥 ROLES DEL SISTEMA — KIA DEALER

## Modelo de Roles en Firebase Auth

Cada usuario tiene un **Custom Claim** asignado desde el backend (Firebase Admin SDK) al momento de crear la cuenta. Este claim viaja dentro del JWT y es verificado por NestJS en cada request.

```json
{
  "role": "JEFE_TALLER | ASESOR | LIDER_TECNICO | PERSONAL_TALLER | DOCUMENTACION",
  "sede": "SURMOTOR | SHYRIS | GRANADAS_CENTENOS | ALL",
  "active": true
}
```

> `sede: "ALL"` es exclusivo del `JEFE_TALLER`. Los demás roles tienen su sede asignada y solo operan dentro de ella.

---

## Definición de Roles

### 1. JEFE_TALLER
**Plataforma:** Web + Móvil | **Sede:** ALL

Supervisor general del sistema. Tiene visibilidad completa de las 3 sedes y acceso CRUD sobre cualquier entidad. Su necesidad principal es la **trazabilidad** (quién hizo qué y cuándo) y el **control de documentos** (visualizar y corregir PDFs).

**Permisos:**

| Módulo | Acceso |
|--------|--------|
| Vehículos | CRUD completo (todas las sedes) |
| Certificación | READ + UPDATE |
| Documentación | READ + UPDATE (corregir documentos) |
| Órdenes de Trabajo | READ completo |
| Agendamiento | READ + UPDATE (reasignar asesor) |
| Reportes | Generar PDF de cualquier vehículo/sede |
| Usuarios | CRUD completo |
| Catálogos | CRUD completo |
| Notificaciones | Recibe TODAS las alertas |

**Funcionalidades exclusivas:**
- Dashboard KPIs por sede (web y móvil)
- Word map de asesores por órdenes de trabajo
- Ver trazabilidad completa de statusHistory
- Gestión de usuarios (crear, editar, desactivar, cambiar contraseña)
- Gestión de catálogos maestros (colores, sedes, modelos, concesionarios, accesorios)
- Reasignar asesor de entrega en agendamientos

---

### 2. ASESOR
**Plataforma:** Móvil | **Sede:** Asignada

Engloba **Asesor de Servicio** y **Asesor de Entrega**. En Shyris es la misma persona; en SurMotor pueden ser distintas. El sistema los unifica bajo un único rol `ASESOR`.

**Permisos:**

| Módulo | Acceso |
|--------|--------|
| Vehículos | CREATE (ingreso QR) + READ (su sede) |
| Certificación | CREATE + UPDATE |
| Órdenes de Trabajo | CREATE |
| Reapertura OT | CREATE |
| Agendamiento | CREATE + UPDATE |
| Ceremonia de entrega | CREATE (solo si es el asesor asignado) |
| Stock | READ filtrado por sede |

**Restricciones:**
- NO puede asignar personal de taller a una OT
- Solo ve vehículos de su sede asignada

---

### 3. LIDER_TECNICO
**Plataforma:** Móvil | **Sede:** Asignada

Comparte las pantallas del `ASESOR`. La diferencia es que **puede asignar personal de taller** a una Orden de Trabajo. En Shyris puede no existir como rol separado.

**Permisos adicionales al ASESOR:**

| Módulo | Acceso |
|--------|--------|
| Asignación de Técnico en OT | EXCLUSIVO — CREATE + UPDATE |
| Marcar Listo para Entrega | UPDATE — después de validar instalación |
| Personal de Taller | READ (ver activos por sede para asignar) |

**Diferenciación en UI:**
Las pantallas son idénticas al ASESOR pero el backend controla qué componentes se renderizan:
- `role === "LIDER_TECNICO"` → muestra selector de técnico en pantalla de OT
- `role === "LIDER_TECNICO"` → muestra botón "Marcar Listo para Entrega"

---

### 4. PERSONAL_TALLER
**Plataforma:** Móvil | **Sede:** Asignada

Técnico que instala físicamente los accesorios. También puede ingresar y certificar vehículos.

**Permisos:**

| Módulo | Acceso |
|--------|--------|
| Vehículos | CREATE (ingreso) |
| Certificación | CREATE + UPDATE |
| Instalación (checklist) | UPDATE — Solo vehículos asignados a su uid |
| Stock | READ — Sin acceso a documentos/PDFs |
| Reporte personal | READ — Solo sus propios KPIs |

**Restricciones:**
- NO puede ver PDFs del vehículo
- NO puede generar OT ni agendar entregas
- Solo marca instalación de vehículos asignados a su `uid`
- Al completar el checklist → estado cambia a `INSTALACION_COMPLETA`

**Menú inferior diferente:** Inicio | Stock | Instalación | Reporte

---

### 5. DOCUMENTACION
**Plataforma:** Web | **Sede:** Asignada

Personal administrativo encargado de la fase postventa. Asocia clientes, carga documentos y clasifica accesorios. También gestiona cambios de sede y cesiones.

**Permisos:**

| Módulo | Acceso |
|--------|--------|
| Vehículos | READ + filtro por sede/chasis |
| Documentación cliente | CREATE + UPDATE |
| Archivos PDF | READ + UPDATE (reemplazar documentos) |
| Cambio de sede | UPDATE |
| Cambio de concesionario | UPDATE + CREATE documento de cesión |
| Catálogos | CRUD — colores, concesionarios, sedes |

**Funcionalidades exclusivas:**
- Asociar datos del cliente (nombre, cédula, teléfono, tipo de matrícula)
- Cargar PDFs: factura vehículo, correo de obsequio, factura de accesorios
- Clasificar accesorios: VENDIDO / OBSEQUIADO / NO_APLICA / campo libre
- Dejar documentación en estado PENDIENTE (standby)
- Ejecutar cambio de sede
- Ceder vehículo a otro concesionario (con documento adjunto)

**Menú sidebar web:** Inicio | Stock | Documentación | Cambio de Sede | Cambio de Concesionario

---

## Matriz de Permisos Consolidada

| Acción | JEFE | ASESOR | LIDER | TALLER | DOC |
|--------|:----:|:------:|:-----:|:------:|:---:|
| Ingresar vehículo | ✅ | ✅ | ✅ | ✅ | ❌ |
| Certificar vehículo | ✅ | ✅ | ✅ | ✅ | ❌ |
| Documentar vehículo | ✅ | ❌ | ❌ | ❌ | ✅ |
| Cambio de sede | ✅ | ❌ | ❌ | ❌ | ✅ |
| Ceder a concesionario | ✅ | ❌ | ❌ | ❌ | ✅ |
| Generar OT | ✅ | ✅ | ✅ | ❌ | ❌ |
| Asignar técnico en OT | ✅ | ❌ | ✅ | ❌ | ❌ |
| Marcar instalación | ❌ | ❌ | ❌ | ✅ | ❌ |
| Marcar listo entrega | ✅ | ❌ | ✅ | ❌ | ❌ |
| Agendar entrega | ✅ | ✅ | ✅ | ❌ | ❌ |
| Ejecutar ceremonia | ✅ | ✅* | ✅* | ❌ | ❌ |
| Reabrir OT | ✅ | ✅ | ✅ | ❌ | ❌ |
| Ver documentos PDF | ✅ | ❌ | ❌ | ❌ | ✅ |
| Gestionar usuarios | ✅ | ❌ | ❌ | ❌ | ❌ |
| Gestionar catálogos | ✅ | ❌ | ❌ | ❌ | ✅** |

> \* Solo si es el asesor asignado al agendamiento
> \** Solo catálogos operativos (colores, concesionarios, sedes)

---

## Documento de Usuario en Firestore

```typescript
// users/{uid}
interface UserDocument {
  uid: string;
  displayName: string;
  email: string;
  role: RoleEnum;
  sede: SedeEnum | 'ALL';
  active: boolean;
  fcmTokens: string[];        // Tokens de dispositivos para push notifications
  createdAt: Timestamp;
  updatedAt: Timestamp;
  createdBy: string;          // uid del Jefe que creó la cuenta
}
```

---

## Flujo de Creación de Usuarios

Solo el `JEFE_TALLER` puede crear cuentas. El flujo es:

1. Jefe envía: nombre, email, role, sede desde web o móvil
2. Backend crea usuario en Firebase Auth via Admin SDK
3. Backend asigna Custom Claims: `{ role, sede, active: true }`
4. Backend crea documento en `users/{uid}` en Firestore
5. Backend envía email de bienvenida con contraseña temporal

**Desactivación:** El Jefe puede desactivar un usuario (`active: false` en el claim). El `FirebaseAuthGuard` rechaza tokens de usuarios con `active: false`.

**Reset de contraseña:** El Jefe genera un reset via Firebase Auth Admin SDK (envía email automático al usuario).