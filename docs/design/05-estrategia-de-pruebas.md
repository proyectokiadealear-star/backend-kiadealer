# 05 — Estrategia de pruebas

Transversal a todas las fases. Define la pirámide exigible, los umbrales que bloquean el merge
y la detección del anti-patrón de pirámide invertida.

---

## 1. Punto de partida real

| Capa | Hoy | Objetivo | Brecha |
|---|---|---|---|
| Unitarios | 11 archivos `.spec.ts` | 55-65% del total | Parcial |
| **Integración** | **0 — no hay emulador configurado** | 25-30% | **Total** |
| E2E / BDD | 1 archivo e2e, sin Cucumber | 10-15% | Casi total |

Módulos **sin ningún test**: `appointments`, `catalogs`, `delivery`, `home`, `seed`, `users`.

Faltantes de infraestructura, todos bloqueantes para la pirámide objetivo:

- `firebase.json` no declara emuladores.
- **No existe ningún `firestore.rules` en el repositorio.** El aislamiento del que depende el
  argumento de venta no está versionado ni es testeable.
- Jest no tiene `coverageThreshold`: no hay puerta de CI.
- Cucumber.js no está instalado.

Todo esto se resuelve en la Fase 0, **antes** de escribir la primera línea de multi-tenancy.
No se puede probar el aislamiento de algo que todavía no se puede levantar en un emulador.

---

## 2. Pirámide objetivo

```
        ▲   E2E / BDD (Cucumber)              10-15%   ~50 escenarios
       / \  Flujos críticos, aislamiento, ceremonia completa
      /---\
     /     \  Integración                     25-30%   ~110 tests
    /       \ Servicio + Firestore emulado, conectores con archivos reales
   /---------\
  /           \ Unitarios                     55-65%   ~240 tests
 /_____________\ Funciones puras, validadores, reglas, cálculo de fechas
```

### Configuración por capa

| Capa | Stack | Ubicación | Cuándo corre | Presupuesto |
|---|---|---|---|---|
| Unitario | Jest + ts-jest | `src/**/*.spec.ts` | Cada push | < 30 s |
| Integración | Jest + Firebase Emulator Suite | `test/integration/**/*.spec.ts` | Cada PR | < 5 min |
| E2E / BDD | Cucumber.js + supertest | `features/**/*.feature` | Cada PR (tag `@critico`) + nightly completo | < 10 min |
| E2E web | Playwright | `web/e2e/**/*.spec.ts` | Nightly | < 15 min |

---

## 3. Umbrales que bloquean el merge

```javascript
// package.json → jest.coverageThreshold
{
  "global": { "branches": 60, "functions": 70, "lines": 70, "statements": 70 },

  "src/common/repositories/**/*.ts":        { "lines": 90, "branches": 85 },
  "src/common/tenant/**/*.ts":              { "lines": 90, "branches": 85 },
  "src/modules/audit/**/*.ts":              { "lines": 85, "branches": 80 },
  "src/modules/public-projection/**/*.ts":  { "lines": 90, "branches": 85 },
  "src/modules/dms-connector/**/*.ts":      { "lines": 80, "branches": 75 },
  "src/modules/billing/**/*.ts":            { "lines": 85, "branches": 80 }
}
```

| Módulo | Cobertura mínima | Feature BDD obligatorio |
|---|---|---|
| `tenant-scoped-repository` | 90% | Sí — REQ-001 |
| `tenant-context` / `TenantGuard` | 90% | Sí — REQ-001, REQ-004 |
| `audit-module` | 85% | Sí — REQ-002 |
| `dms-connector/*` | 80% | Sí — REQ-003, dos formatos mínimo |
| `public-projection-service` | 90% | Sí — REQ-014, REQ-015 |
| `billing` (add-on SRI) | 85% | Sí — REQ-005, secuenciales sin duplicados |
| Resto de `modules/` | 70% | Cuando el flujo sea crítico de negocio |
| `web` / `front-movil` | 50% (lógica, no markup) | Solo flujos críticos con Playwright |

**Regla de bloqueo:** si la cobertura de un módulo cae por debajo de su umbral, el pull request
no mergea. `jest --coverage` con `coverageThreshold` ya falla con código de salida distinto de
cero; no hace falta scripting adicional para eso.

**Regla de trinquete:** además del umbral absoluto, la cobertura global no puede **bajar**
respecto de `main`. Se compara el resumen JSON de cobertura de la rama contra el de la base y
se falla si retrocede más de 0,5 puntos. Esto impide el patrón de agregar mucho código apenas
por encima del mínimo y erosionar el conjunto.

---

## 4. Anti-patrón: pirámide invertida

Si un módulo tiene más escenarios E2E que tests unitarios, el diseño está acoplado: la lógica
de negocio está mezclada con infraestructura y solo se puede ejercitar levantando todo el stack.

El reporte de CI publica el conteo **por capa y por módulo**, no solo el porcentaje global:

```
Módulo                        Unit   Integr   E2E    Forma
─────────────────────────────────────────────────────────────
common/repositories             34       12      6    OK
modules/audit                   28        9      4    OK
modules/dms-connector           41       18      6    OK
modules/public-projection       37        7      5    OK
modules/delivery                 3        2      7    INVERTIDA
─────────────────────────────────────────────────────────────
Total                          240      110     50    60/27/13
```

Se implementa con un script que cuenta bloques `it(` / `test(` por directorio y escenarios por
`.feature`, y marca `INVERTIDA` cuando E2E supera a unitarios en un mismo módulo. Es una
**alerta visible en el PR**, no un bloqueo: hay módulos legítimamente delgados. Lo que no es
legítimo es que nadie lo mire.

---

## 5. Infraestructura a construir (Fase 0)

### 5.1 Emulador

```json
// backend/firebase.json
{
  "firestore": {
    "rules": "firestore.rules",
    "indexes": "firestore.indexes.json"
  },
  "emulators": {
    "auth":      { "port": 9099 },
    "firestore": { "port": 8080 },
    "storage":   { "port": 9199 },
    "ui":        { "enabled": true, "port": 4000 }
  }
}
```

### 5.2 Reglas versionadas

Se crea `backend/firestore.rules` con acceso directo denegado, y se prueba con
`@firebase/rules-unit-testing`. Que el backend use Admin SDK —que ignora las reglas— no vuelve
esto opcional: las reglas son la defensa contra alguien que obtenga credenciales de cliente y
consulte Firestore directo.

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

### 5.3 Dependencias nuevas

```
firebase-tools                    devDependency
@firebase/rules-unit-testing      devDependency
@cucumber/cucumber                devDependency
```

### 5.4 Scripts

```json
{
  "test:unit": "jest",
  "test:integration": "firebase emulators:exec --only firestore,auth,storage \"jest --config test/jest-integration.json\"",
  "test:bdd": "firebase emulators:exec --only firestore,auth,storage \"cucumber-js\"",
  "test:bdd:critico": "firebase emulators:exec --only firestore,auth,storage \"cucumber-js --tags @critico\"",
  "test:shape": "node scripts/test-shape-report.js",
  "test:ci": "npm run test:unit -- --coverage && npm run test:integration && npm run test:bdd:critico && npm run test:shape"
}
```

---

## 6. Pipeline de CI

```
push a rama
  └─ lint (incluye la regla que prohíbe rawFirestore fuera de repositorios)
  └─ test:unit --coverage          ← puerta de umbrales
  └─ < 1 min total

pull request
  └─ todo lo anterior
  └─ test:integration              ← emulador
  └─ test:bdd:critico              ← tag @critico: aislamiento, auditoría, proyección
  └─ test:shape                    ← reporte de forma de la pirámide
  └─ trinquete de cobertura vs main
  └─ < 8 min total

nightly
  └─ suite BDD completa
  └─ Playwright sobre web
  └─ verificación de cadena de hash de auditoría sobre datos de staging
```

**Regla no negociable:** los escenarios etiquetados `@seguridad` corren en cada pull request.
Una falla de aislamiento entre concesionarios está clasificada como riesgo fatal —legal y
reputacional— en el análisis de riesgos. Un control de riesgo fatal que se verifica
trimestralmente no es un control.

---

## 7. Qué automatiza Claude y qué no

Distinción honesta, porque inflar la aceleración por IA es la forma más común de incumplir un
cronograma.

| Tarea | Palanca | Nota |
|---|---|---|
| Escribir tests unitarios desde un contrato definido | **Alta — 3x** | Es trabajo mecánico con criterio claro |
| Migrar los 165 call sites al repositorio | **Alta — 3 a 4x** | Patrón repetitivo; el patrón lo define un humano |
| Generar DTOs, validadores, Swagger | **Alta — 4x** | |
| Escribir step definitions de Cucumber | Alta — 3x | |
| Escribir los `.feature` | Media | El humano decide qué es crítico de negocio |
| Configurar emulador, CI, IAM, proyectos GCP | Nula | Trabajo de infraestructura y credenciales |
| Diseñar el mapa de hitos y el lenguaje al cliente | Baja | Lo valida el gerente del concesionario |
| **Revisión adversarial del aislamiento** | **Con cuidado** | Ver abajo |

**Claude no puede ser el único revisor del aislamiento entre tenants.** Que escriba la suite es
exactamente donde más aporta. Pero lo único que separa al producto de filtrar datos de un
concesionario a otro necesita revisión humana adversarial: quien escribe los tests comparte los
puntos ciegos de quien escribió el código, y acá el costo de un punto ciego es el negocio entero.
