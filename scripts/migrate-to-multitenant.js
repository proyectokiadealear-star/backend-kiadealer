#!/usr/bin/env node

/**
 * Migra el concesionario existente al modelo multi-tenant.
 *
 * Idempotente: puede correrse varias veces sin duplicar ni corromper. Por
 * defecto hace SIMULACIÓN — no escribe nada. Requiere --commit explícito.
 *
 *   node scripts/migrate-to-multitenant.js --tenant kia-quito
 *   node scripts/migrate-to-multitenant.js --tenant kia-quito --commit
 *
 * ORDEN OBLIGATORIO de la migración completa (docs/design/01-multi-tenancy.md §5):
 *   1. migrar los 14 módulos a TenantScopedRepository
 *   2. ESTE SCRIPT: tenantId + establishmentId en todos los documentos
 *   3. desplegar índices con tenantId y esperar su construcción
 *   4. re-emitir custom claims de todos los usuarios
 *   5. recién entonces registrar TenantGuard en AppModule
 *
 * El paso 4 es el que hunde el despliegue si se olvida: los claims viven en
 * Firebase Auth, no en Firestore. Sin re-emitirlos, TenantGuard rechaza a
 * todos los usuarios con 401.
 */

const admin = require('firebase-admin');

const BATCH_SIZE = 500; // Límite de operaciones por batch de Firestore.

const SCOPED_COLLECTIONS = [
  'vehicles',
  'certifications',
  'documentations',
  'serviceOrders',
  'appointments',
  'deliveryCeremonies',
  'users',
  'notifications',
];

/** Sucursales actuales, derivadas de SedeEnum. Ver D-107. */
const ESTABLISHMENTS = [
  { id: 'surmotor', code: 'SURMOTOR', name: 'Surmotor', active: true },
  {
    id: 'granda-centeno',
    code: 'GRANDA_CENTENO',
    name: 'Granda Centeno',
    active: true,
  },
];

function parseArgs(argv) {
  const tenantIndex = argv.indexOf('--tenant');
  return {
    tenantId: tenantIndex !== -1 ? argv[tenantIndex + 1] : null,
    commit: argv.includes('--commit'),
  };
}

function initFirebase() {
  if (admin.apps.length > 0) return admin.app();
  return admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: (process.env.FIREBASE_PRIVATE_KEY || '').replace(
        /\\n/g,
        '\n',
      ),
    }),
  });
}

async function ensureTenant(db, tenantId, commit) {
  const ref = db.collection('tenants').doc(tenantId);
  const snapshot = await ref.get();

  if (snapshot.exists) {
    console.log(`  tenants/${tenantId} ya existe — sin cambios`);
    return;
  }

  console.log(`  ${commit ? 'creando' : 'crearia'} tenants/${tenantId}`);
  if (!commit) return;

  await ref.set({
    name: tenantId,
    ruc: process.env.MIGRATION_TENANT_RUC || '',
    status: 'ACTIVE',
    plan: 'legacy',
    createdAt: new Date().toISOString(),
  });
}

async function ensureEstablishments(db, tenantId, commit) {
  const parent = db
    .collection('tenants')
    .doc(tenantId)
    .collection('establishments');

  for (const establishment of ESTABLISHMENTS) {
    const ref = parent.doc(establishment.id);
    if ((await ref.get()).exists) {
      console.log(
        `  establishments/${establishment.id} ya existe — sin cambios`,
      );
      continue;
    }
    console.log(
      `  ${commit ? 'creando' : 'crearia'} establishments/${establishment.id}`,
    );
    if (commit) await ref.set(establishment);
  }
}

/** Resuelve el establishmentId a partir del valor legado de `sede`. */
function resolveEstablishmentId(sede) {
  if (!sede) return null;
  const match = ESTABLISHMENTS.find((item) => item.code === sede);
  return match ? match.id : null;
}

async function backfillCollection(db, collectionName, tenantId, commit) {
  const snapshot = await db.collection(collectionName).get();

  let alreadyTagged = 0;
  let toUpdate = 0;
  let unmappedSede = 0;
  let batch = db.batch();
  let pendingInBatch = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data();

    if (data.tenantId === tenantId && data.establishmentId) {
      alreadyTagged += 1;
      continue;
    }

    const changes = {};
    if (data.tenantId !== tenantId) changes.tenantId = tenantId;

    if (!data.establishmentId && data.sede) {
      const establishmentId = resolveEstablishmentId(data.sede);
      if (establishmentId) {
        changes.establishmentId = establishmentId;
      } else {
        unmappedSede += 1;
        console.warn(
          `    aviso: ${collectionName}/${doc.id} tiene sede "${data.sede}" sin sucursal equivalente`,
        );
      }
    }

    if (Object.keys(changes).length === 0) continue;

    toUpdate += 1;
    if (!commit) continue;

    batch.update(doc.ref, changes);
    pendingInBatch += 1;

    if (pendingInBatch === BATCH_SIZE) {
      await batch.commit();
      batch = db.batch();
      pendingInBatch = 0;
    }
  }

  if (commit && pendingInBatch > 0) await batch.commit();

  return { total: snapshot.size, alreadyTagged, toUpdate, unmappedSede };
}

async function verify(db, collectionName, tenantId) {
  const total = (await db.collection(collectionName).count().get()).data()
    .count;
  const tagged = (
    await db
      .collection(collectionName)
      .where('tenantId', '==', tenantId)
      .count()
      .get()
  ).data().count;
  return { total, tagged, missing: total - tagged };
}

async function main() {
  const { tenantId, commit } = parseArgs(process.argv);

  if (!tenantId) {
    console.error('Falta --tenant <id>. Ejemplo: --tenant kia-quito');
    process.exit(1);
  }

  console.log(
    commit
      ? `\n### MIGRACION REAL — se escribira en Firestore (tenant: ${tenantId})\n`
      : `\n### SIMULACION — no se escribe nada. Agrega --commit para ejecutar. (tenant: ${tenantId})\n`,
  );

  const db = initFirebase().firestore();

  console.log('Paso 1 — concesionario y sucursales');
  await ensureTenant(db, tenantId, commit);
  await ensureEstablishments(db, tenantId, commit);

  console.log('\nPaso 2 — asignacion de tenantId y establishmentId');
  for (const collectionName of SCOPED_COLLECTIONS) {
    const result = await backfillCollection(
      db,
      collectionName,
      tenantId,
      commit,
    );
    console.log(
      `  ${collectionName.padEnd(20)} total=${result.total} ` +
        `ya_migrados=${result.alreadyTagged} ` +
        `${commit ? 'actualizados' : 'a_actualizar'}=${result.toUpdate}` +
        (result.unmappedSede > 0
          ? ` sede_sin_mapeo=${result.unmappedSede}`
          : ''),
    );
  }

  if (!commit) {
    console.log(
      '\nSimulacion completa. Revisa los numeros antes de correr con --commit.',
    );
    return;
  }

  console.log('\nPaso 3 — verificacion de conteos');
  let allClean = true;
  for (const collectionName of SCOPED_COLLECTIONS) {
    const check = await verify(db, collectionName, tenantId);
    if (check.missing !== 0) allClean = false;
    console.log(
      `  ${collectionName.padEnd(20)} ${check.tagged}/${check.total} ` +
        `${check.missing === 0 ? 'OK' : 'INCOMPLETO'}`,
    );
  }

  if (!allClean) {
    console.error(
      '\nHay documentos sin tenantId. NO avances al paso siguiente.',
    );
    process.exit(1);
  }

  console.log('\nMigracion de datos completa.');
  console.log('SIGUIENTE: desplegar indices, luego re-emitir claims, y recien');
  console.log('entonces registrar TenantGuard en AppModule.');
}

main().catch((error) => {
  console.error('\nMigracion abortada:', error.message);
  process.exit(1);
});
