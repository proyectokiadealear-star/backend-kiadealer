# 06 — Runbook de migración a multi-tenant

Procedimiento operativo para migrar el concesionario existente. **El orden no es
negociable**: cada paso asume que el anterior terminó y fue verificado.

---

## Por qué el orden importa

Los tres errores que rompen el sistema:

1. **Migrar los módulos antes que los datos.** Un módulo migrado consulta con
   `where('tenantId','==',ctx.tenantId)` y `findById` compara pertenencia. Si los documentos
   todavía no tienen `tenantId`, la comparación es `undefined !== 'kia-quito'` y **todo devuelve
   `null`** — el fallo cerrado rompe el negocio en vez de protegerlo. Como la asignación de
   `tenantId` es puramente aditiva y el código viejo ignora el campo de más, migrar los datos
   primero elimina el problema por completo.
2. **Registrar `TenantGuard` antes de re-emitir los claims.** Los claims viven en Firebase Auth,
   no en Firestore — el script de datos no los toca. Sin `tenantId` en el token, el guard
   rechaza a **todos** los usuarios con 401.
3. **Activar el guard antes de que los índices estén construidos.** Toda consulta con
   `where('tenantId')` más `orderBy` necesita su índice compuesto. Sin él, Firestore responde
   `FAILED_PRECONDITION` en cada request.

> **Corrección aplicada.** La primera versión de este runbook ponía la migración de módulos antes
> que la de datos. Ese orden obliga a que cada módulo migrado que consulte un módulo hermano aún
> sin migrar necesite un «accesor puente» que tolere documentos sin `tenantId` — deuda que se
> multiplica por cada par de módulos acoplados. Con los datos migrados primero, esos puentes no
> hacen falta. El caso concreto que lo destapó: `delivery.createCeremony` lee y actualiza
> `appointments`.

---

## Paso 1 — Desplegar los índices

Van primero porque su construcción tarda y existir de más no rompe nada: un índice sin
consultas que lo usen solo ocupa almacenamiento.

```bash
npx firebase deploy --only firestore:indexes --project <proyecto>
```

Los 19 índices llevan `tenantId` como **primer campo**. No es una optimización: Firestore exige
que los campos de igualdad precedan a los de rango y ordenamiento.

**Esperar a que todos estén en estado `Enabled`** en la consola de Firebase. Sobre una colección
grande puede tardar minutos u horas.

---

## Paso 2 — Asignar `tenantId` y `establishmentId` a los datos

Simulación primero, siempre:

```bash
node scripts/migrate-to-multitenant.js --tenant kia-quito
```

Revisar los conteos por colección. Recién entonces:

```bash
node scripts/migrate-to-multitenant.js --tenant kia-quito --commit
```

El script es idempotente y verifica conteos antes/después. **Aborta con código 1 si queda algún
documento sin `tenantId`.** Si eso pasa, no avances: investigá qué colección quedó afuera.

Atención al aviso `sede_sin_mapeo`: significa que hay documentos con un valor de `sede` que no
corresponde a ninguna sucursal conocida. Esos quedan sin `establishmentId` y hay que resolverlos
a mano antes de seguir.

---

## Paso 3 — Desplegar los índices y esperar

```bash
npx firebase deploy --only firestore:indexes --project <proyecto>
```

Los 19 índices llevan `tenantId` como **primer campo**. No es una optimización: Firestore exige
que los campos de igualdad precedan a los de rango y ordenamiento.

**Esperar a que todos estén en estado `Enabled`** en la consola de Firebase. La construcción
sobre una colección grande tarda minutos u horas. Avanzar antes rompe todas las consultas.

---

## Paso 4 — Re-emitir los custom claims

Este es el paso que se olvida.

```bash
node scripts/remint-claims.js --tenant kia-quito
node scripts/remint-claims.js --tenant kia-quito --commit
```

El script preserva los claims existentes (`role`, `active`) y agrega `tenantId` y
`establishmentIds`. Sobreescribir el objeto entero borraría el rol de cada usuario.

**Propagación:** los ID tokens ya emitidos siguen siendo válidos **hasta una hora**. Un usuario
con sesión abierta no ve el claim nuevo hasta que su token se refresque. Dos opciones:

- Esperar una hora entre el paso 4 y el 5.
- Correr con `--revoke-sessions`, que fuerza a todos a reautenticarse de inmediato. Más abrupto,
  pero elimina la ventana de incertidumbre.

Si algún usuario falla, el script sale con código 1. **No avances con usuarios sin claim**:
quedarían bloqueados en cuanto se registre el guard.

---

### Trampa: `setCustomUserClaims` reemplaza, no fusiona

`auth().setCustomUserClaims(uid, {...})` **sobreescribe el objeto de claims completo**. No hace
merge.

El código original de `UsersService.update()` escribía `{role, sede, active}` en cada edición.
Con eso, la primera vez que alguien cambiara el rol de un usuario desde el admin —días o semanas
después de la migración— se le borraban `tenantId` y `establishmentIds`, y ese usuario pasaba a
recibir 401 de `TenantGuard`. Un usuario a la vez, sin patrón visible, imposible de correlacionar
con el despliegue.

Ya está corregido: `UsersRepository.assignClaims()` lee los claims vigentes con `getUser(uid)` y
los fusiona antes de escribir. **Cualquier código nuevo que toque claims debe hacer lo mismo.**

---

## Paso 5 — Registrar `TenantGuard`

Recién ahora, en `src/app.module.ts`:

```typescript
providers: [
  { provide: APP_INTERCEPTOR, useClass: TenantContextInterceptor },
  { provide: APP_GUARD, useClass: TenantGuard },   // ← se agrega en este paso
],
```

Verificación inmediata tras el despliegue:

- Un usuario existente puede autenticarse y listar vehículos.
- La suite de aislamiento sigue verde contra el emulador.
- No aparecen `FAILED_PRECONDITION` en los logs.

---

## Reversión

| Paso | ¿Reversible? | Cómo |
|---|---|---|
| 1 — módulos | Sí | Revertir el commit |
| 2 — datos | Sí, aditivo | El script solo agrega campos; no borra ni modifica los existentes |
| 3 — índices | Sí | Los índices de más no rompen nada, solo cuestan almacenamiento |
| 4 — claims | Parcial | Los claims viejos se preservan; se puede volver a emitir sin `tenantId` |
| 5 — guard | Sí | Quitar el `APP_GUARD` y desplegar |

El paso 2 es aditivo a propósito: agrega `tenantId` y `establishmentId` sin tocar `sede` ni
ningún otro campo. Eso permite que el código viejo y el nuevo convivan durante la transición, y
es lo que hace reversible toda la migración.

---

## Cambios de contrato introducidos por la migración

La migración es mayormente transparente, pero tres cambios sí se notan desde afuera. Hay que
verificarlos contra el frontend web y el móvil **antes** de desplegar.

| Cambio | Módulo | Antes | Ahora | Por qué |
|---|---|---|---|---|
| `DELETE` de un ítem inexistente | catalogs | `200 {deleted:true}` | `404` | Devolver éxito sin borrar nada es mentirle al llamador. Además es indistinguible del caso entre concesionarios, que exige 404 por D-104 |
| Id de ítems nuevos | catalogs | `blanco-perla` | `kia-quito__blanco-perla` | `catalogs/{tipo}/items` es una subcolección **compartida** entre concesionarios. Sin prefijo, dos concesionarios que nombren un color igual colisionan y el segundo pisa al primero |
| Campo `id` en la respuesta | certifications | ausente | presente | Aditivo: el repositorio base siempre inyecta el id del documento |

Los ids existentes **no cambian**: el prefijo solo aplica a ítems creados después del despliegue.
Un `findById` sobre un id viejo sigue funcionando. Quedan ids de dos formatos conviviendo, que es
feo pero funcional; unificarlos requiere una migración de datos aparte que no vale la pena hoy.

**Acción requerida antes de desplegar:** confirmar que el frontend no rompe con el `404` en
`DELETE` de catálogos. Es el único cambio con potencial de romper un flujo existente.

---

## Convención: accesores puente

Un módulo migrado que necesita leer o escribir la colección de un módulo hermano **aún no
migrado** no puede usar `TenantScopedRepository`: los documentos destino todavía no tienen
`tenantId`, así que la comparación de pertenencia daría `undefined !== ctx.tenantId` y todo
devolvería `null`.

La convención única es `MigrationBridgeRepository`
(`src/common/repositories/migration-bridge.repository.ts`):

- Aplica scope cuando el documento **ya tiene** `tenantId`.
- Solo tolera su **ausencia** — el caso pre-migración. Un documento de otro concesionario nunca
  es accesible.
- Emite un warning con el nombre del módulo que vuelve innecesario el puente.

La tolerancia vive ahí, en un artefacto temporal y acotado, **nunca** en
`TenantScopedRepository`: el primitivo de aislamiento se mantiene estricto.

Puentes vigentes, a borrar cuando su destino migre:

| Puente | Colección destino | Se elimina al migrar |
|---|---|---|
| `AppointmentLookupRepository` | `appointments` | `AppointmentsService` |
| `VehicleFieldsRepository` | `vehicles` | `VehiclesService` |

Si el paso 2 corre antes que el 3 —como manda este runbook—, la rama de tolerancia queda muerta
y el warning deja de emitirse. Ese silencio es la señal de que el puente sobra.

---

## Criterio de salida

- [ ] `eslint` reporta 0 violaciones y la lista de `ignores` solo tiene rutas autorizadas
- [ ] 100% de los documentos con `tenantId` en todas las colecciones
- [ ] 19 índices en estado `Enabled`
- [ ] 100% de los usuarios con claim `tenantId`
- [ ] `TenantGuard` registrado y suite de aislamiento verde
- [ ] Dos tenants de prueba conviviendo sin filtración
