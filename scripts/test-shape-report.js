#!/usr/bin/env node

/**
 * Reporte de forma de la pirámide de pruebas.
 *
 * No mide cobertura (eso lo hace Jest con --coverageThreshold). Mide
 * PROPORCIÓN: cuántos tests unitarios, de integración y E2E/BDD existen,
 * por capa y por módulo, y advierte cuando un módulo tiene más peso en
 * E2E que en unitarios — la señal de diseño acoplado descrita en
 * docs/design/05-estrategia-de-pruebas.md §4.
 *
 * Uso: node scripts/test-shape-report.js [--json]
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const TARGET_RANGES = { unit: [55, 65], integration: [25, 30], e2e: [10, 15] };

/** Recorre un directorio recursivamente y devuelve archivos que matchean el filtro. */
function walk(dir, matches, found = []) {
  if (!fs.existsSync(dir)) return found;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      walk(fullPath, matches, found);
    } else if (matches(entry.name)) {
      found.push(fullPath);
    }
  }
  return found;
}

/**
 * Cuenta ocurrencias de it(...)/test(...) de nivel de caso en un .spec.ts.
 *
 * Limitación conocida: un `it.each([...])` cuenta como UN caso aunque en
 * ejecución expanda a tantos como filas tenga la tabla. El conteo estático no
 * puede evaluar el arreglo. La forma real de la pirámide tiende a estar mejor
 * de lo que muestra este reporte, nunca peor.
 */
function countTestCases(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const matches = content.match(/\b(it|test)\s*\(\s*['"`]/g);
  return matches ? matches.length : 0;
}

/** Cuenta Escenario / Esquema del escenario en un archivo .feature. */
function countScenarios(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const matches = content.match(/^\s*(Escenario|Esquema del escenario):/gm);
  return matches ? matches.length : 0;
}

/** Agrupa archivos .spec.ts unitarios (fuera de test/) por módulo de src/. */
function unitCountsByModule() {
  const specFiles = walk(path.join(ROOT, 'src'), (name) =>
    name.endsWith('.spec.ts'),
  );
  const byModule = new Map();

  for (const file of specFiles) {
    const relative = path.relative(path.join(ROOT, 'src'), file);
    const segments = relative.split(path.sep);
    const moduleName = segments.length > 1 ? segments[0] : '(raíz)';
    const submodule =
      segments.length > 2 ? `${segments[0]}/${segments[1]}` : moduleName;
    const key =
      segments[0] === 'modules'
        ? submodule.replace('modules/', '')
        : moduleName;

    byModule.set(key, (byModule.get(key) ?? 0) + countTestCases(file));
  }
  return byModule;
}

function integrationCounts() {
  const files = walk(path.join(ROOT, 'test', 'integration'), (name) =>
    name.endsWith('.spec.ts'),
  );
  const securityFiles = walk(path.join(ROOT, 'test', 'security'), (name) =>
    name.endsWith('.spec.ts'),
  );
  return [...files, ...securityFiles].reduce(
    (sum, f) => sum + countTestCases(f),
    0,
  );
}

function e2eCountsByFeature() {
  const files = walk(path.join(ROOT, 'features'), (name) =>
    name.endsWith('.feature'),
  );
  const byFeature = new Map();
  for (const file of files) {
    byFeature.set(path.basename(file, '.feature'), countScenarios(file));
  }
  return byFeature;
}

function percentageWithinRange(value, [min, max]) {
  return value >= min && value <= max;
}

function buildReport() {
  const unitByModule = unitCountsByModule();
  const unitTotal = [...unitByModule.values()].reduce((a, b) => a + b, 0);
  const integrationTotal = integrationCounts();
  const e2eByFeature = e2eCountsByFeature();
  const e2eTotal = [...e2eByFeature.values()].reduce((a, b) => a + b, 0);
  const grandTotal = unitTotal + integrationTotal + e2eTotal;

  const shape =
    grandTotal === 0
      ? { unit: 0, integration: 0, e2e: 0 }
      : {
          unit: Math.round((unitTotal / grandTotal) * 100),
          integration: Math.round((integrationTotal / grandTotal) * 100),
          e2e: Math.round((e2eTotal / grandTotal) * 100),
        };

  const modulesSinTests = [...unitByModule.entries()]
    .filter(([, count]) => count === 0)
    .map(([name]) => name);

  return {
    totals: {
      unit: unitTotal,
      integration: integrationTotal,
      e2e: e2eTotal,
      grandTotal,
    },
    shape,
    withinTarget: {
      unit: percentageWithinRange(shape.unit, TARGET_RANGES.unit),
      integration: percentageWithinRange(
        shape.integration,
        TARGET_RANGES.integration,
      ),
      e2e: percentageWithinRange(shape.e2e, TARGET_RANGES.e2e),
    },
    unitByModule: Object.fromEntries(unitByModule),
    e2eByFeature: Object.fromEntries(e2eByFeature),
    modulesSinTests,
  };
}

function printHumanReadable(report) {
  const {
    totals,
    shape,
    withinTarget,
    unitByModule,
    e2eByFeature,
    modulesSinTests,
  } = report;

  console.log('\nForma de la pirámide de pruebas\n');
  console.log(
    `  Unitarios     ${String(totals.unit).padStart(4)}  (${shape.unit}%)  objetivo 55-65%  ${withinTarget.unit ? 'OK' : 'FUERA DE RANGO'}`,
  );
  console.log(
    `  Integración   ${String(totals.integration).padStart(4)}  (${shape.integration}%)  objetivo 25-30%  ${withinTarget.integration ? 'OK' : 'FUERA DE RANGO'}`,
  );
  console.log(
    `  E2E / BDD     ${String(totals.e2e).padStart(4)}  (${shape.e2e}%)  objetivo 10-15%  ${withinTarget.e2e ? 'OK' : 'FUERA DE RANGO'}`,
  );
  console.log(`  Total         ${totals.grandTotal}\n`);

  console.log('Tests unitarios por módulo (src/modules/*):');
  for (const [moduleName, count] of Object.entries(unitByModule).sort()) {
    console.log(
      `  ${count === 0 ? '⚠ ' : '  '}${moduleName.padEnd(28)} ${count}`,
    );
  }

  if (modulesSinTests.length > 0) {
    console.log(
      `\nMódulos sin ningún test unitario: ${modulesSinTests.join(', ')}`,
    );
  }

  console.log('\nEscenarios BDD por feature:');
  for (const [featureName, count] of Object.entries(e2eByFeature).sort()) {
    console.log(`  ${featureName.padEnd(28)} ${count}`);
  }
  console.log(
    '\nNota: un it.each() cuenta como 1 caso aunque expanda a varios en ejecución.',
  );
  console.log(
    'La forma real tiende a estar mejor que la reportada, nunca peor.\n',
  );
}

function main() {
  const report = buildReport();
  const asJson = process.argv.includes('--json');

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printHumanReadable(report);
  }
}

main();
