# Suite BDD — Cucumber

Escenarios ejecutables que verifican los requisitos críticos de negocio y de seguridad.
Corren contra la API real levantada sobre el Firebase Emulator Suite.

El diseño que sustenta estos escenarios está en [`docs/design/`](../../docs/design/README.md).

## Estructura

```
features/
├── aislamiento-tenant.feature     REQ-001, REQ-004, REQ-020
├── auditoria-inmutable.feature    REQ-002
├── importacion-dms.feature        REQ-003
├── proyeccion-publica.feature     REQ-014, REQ-015
└── step_definitions/
    ├── world.ts                   contexto compartido, cliente supertest
    ├── hooks.ts                   limpieza del emulador entre escenarios
    ├── auth.steps.ts              autenticación y claims
    ├── tenant.steps.ts            concesionarios, usuarios, aislamiento
    ├── vehicles.steps.ts          vehículos y cambios de estado
    ├── audit.steps.ts             cadena de hash y verificación
    ├── import.steps.ts            conectores y reportes de importación
    └── public.steps.ts            proyección pública y bóveda
```

## Etiquetas

| Etiqueta | Significado | Cuándo corre |
|---|---|---|
| `@critico` | Flujo crítico de negocio | Cada pull request |
| `@seguridad` | Escenario adversarial | Cada pull request, sin excepción |
| `@REQ-nnn` | Trazabilidad al requisito | Filtrado bajo demanda |
| `@lopdp` | Protección de datos personales | Cada pull request |
| `@arquitectura` | Restricción estructural verificable | Cada pull request |
| `@escape-hatch` | Operación de plataforma entre concesionarios | Cada pull request |
| `@dos-formatos` | Exigencia de dos formatos de importación distintos | Cada pull request |

Los escenarios `@seguridad` no se posponen ni se marcan como pendientes. Una falla de
aislamiento entre concesionarios está clasificada como riesgo fatal —legal y reputacional—;
un control de riesgo fatal que se verifica trimestralmente no es un control.

## Ejecución

Suite completa:

```bash
npm run test:bdd
```

Solo los escenarios que bloquean el merge:

```bash
npm run test:bdd:critico
```

Un requisito puntual:

```bash
npx cucumber-js --tags @REQ-001
```

## Requisitos previos

- Firebase Emulator Suite configurado en `firebase.json` (Fase 0).
- `firestore.rules` versionado en el repositorio (Fase 0).
- Fixtures de importación en `test/fixtures/imports/`.

## Datos de prueba

Los archivos de `test/fixtures/imports/` usan datos anonimizados: VIN sintéticos válidos según
ISO 3779 y cédulas ecuatorianas que pasan el validador de dígito verificador sin corresponder
a personas reales. **Nunca se versiona un archivo con datos de clientes reales**, ni siquiera
parcialmente enmascarado.

## Convención al agregar escenarios

1. Todo escenario nuevo lleva su etiqueta `@REQ-nnn`; si el requisito no existe, se agrega
   primero a la tabla de trazabilidad de `docs/design/README.md`.
2. Los pasos se escriben en lenguaje de negocio. Si un paso menciona una colección de Firestore
   o un código de estado HTTP interno, probablemente pertenece a la capa de integración, no a BDD.
3. Antes de agregar un escenario E2E, verificar que la lógica no se pueda cubrir con un test
   unitario. La pirámide se invierte de a un escenario por vez.
