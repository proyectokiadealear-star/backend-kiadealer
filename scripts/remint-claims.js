#!/usr/bin/env node

/**
 * Re-emite los custom claims de Firebase Auth con `tenantId` y
 * `establishmentIds`.
 *
 * PASO 4 de la migración. Es el que hunde el despliegue si se olvida: los
 * claims viven en Firebase Auth, NO en Firestore, así que el script de
 * migración de datos no los toca. Sin este paso, en cuanto se registre
 * TenantGuard todos los usuarios reciben 401 y el sistema queda inaccesible.
 *
 *   node scripts/remint-claims.js --tenant kia-quito
 *   node scripts/remint-claims.js --tenant kia-quito --commit
 *
 * Idempotente: un usuario que ya tiene el claim correcto se omite.
 *
 * IMPORTANTE sobre la propagación: los ID tokens ya emitidos siguen siendo
 * válidos hasta una hora. Un usuario con sesión abierta no ve el claim nuevo
 * hasta que su token se refresque. Por eso el orden es re-emitir claims
 * ANTES de registrar TenantGuard, y esperar al menos una hora —o forzar
 * revocación con --revoke-sessions— entre ambos pasos.
 */

const admin = require('firebase-admin');

const PAGE_SIZE = 1000; // Máximo que acepta listUsers por página.

/** Mapea el valor legado de `sede` al establishmentId equivalente. Ver D-107. */
const SEDE_TO_ESTABLISHMENT = {
  SURMOTOR: 'surmotor',
  GRANDA_CENTENO: 'granda-centeno',
};

function parseArgs(argv) {
  const tenantIndex = argv.indexOf('--tenant');
  return {
    tenantId: tenantIndex !== -1 ? argv[tenantIndex + 1] : null,
    commit: argv.includes('--commit'),
    revokeSessions: argv.includes('--revoke-sessions'),
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

/** Resuelve las sucursales del usuario a partir de su `sede` legada. */
function resolveEstablishmentIds(claims) {
  if (Array.isArray(claims.establishmentIds)) return claims.establishmentIds;
  const mapped = SEDE_TO_ESTABLISHMENT[claims.sede];
  return mapped ? [mapped] : [];
}

function needsRemint(claims, tenantId) {
  return (
    claims.tenantId !== tenantId || !Array.isArray(claims.establishmentIds)
  );
}

async function collectUsers(auth) {
  const users = [];
  let pageToken;

  do {
    const result = await auth.listUsers(PAGE_SIZE, pageToken);
    users.push(...result.users);
    pageToken = result.pageToken;
  } while (pageToken);

  return users;
}

async function main() {
  const { tenantId, commit, revokeSessions } = parseArgs(process.argv);

  if (!tenantId) {
    console.error('Falta --tenant <id>. Ejemplo: --tenant kia-quito');
    process.exit(1);
  }

  console.log(
    commit
      ? `\n### RE-EMISION REAL de claims (tenant: ${tenantId})\n`
      : `\n### SIMULACION — no se modifica nada. Agrega --commit. (tenant: ${tenantId})\n`,
  );

  const auth = initFirebase().auth();
  const users = await collectUsers(auth);

  let reminted = 0;
  let skipped = 0;
  let failed = 0;

  for (const user of users) {
    const claims = user.customClaims || {};

    if (!needsRemint(claims, tenantId)) {
      skipped += 1;
      continue;
    }

    const establishmentIds = resolveEstablishmentIds(claims);

    if (establishmentIds.length === 0) {
      console.warn(
        `  aviso: ${user.email || user.uid} sin sede reconocible ` +
          `(sede="${claims.sede}") — queda sin sucursales asignadas`,
      );
    }

    // Se preservan los claims existentes (role, active) y se agregan los
    // nuevos. Sobreescribir el objeto entero borraría el rol del usuario.
    const nextClaims = { ...claims, tenantId, establishmentIds };

    if (!commit) {
      console.log(
        `  reemitiria ${user.email || user.uid} → tenantId=${tenantId} ` +
          `establishmentIds=[${establishmentIds.join(',')}]`,
      );
      reminted += 1;
      continue;
    }

    try {
      await auth.setCustomUserClaims(user.uid, nextClaims);
      if (revokeSessions) await auth.revokeRefreshTokens(user.uid);
      reminted += 1;
      console.log(`  OK ${user.email || user.uid}`);
    } catch (error) {
      failed += 1;
      console.error(`  FALLO ${user.email || user.uid}: ${error.message}`);
    }
  }

  console.log(
    `\nTotal=${users.length} ${commit ? 'reemitidos' : 'a_reemitir'}=${reminted} ` +
      `sin_cambios=${skipped} fallidos=${failed}`,
  );

  if (failed > 0) {
    console.error(
      '\nHay usuarios sin claim. NO registres TenantGuard todavia.',
    );
    process.exit(1);
  }

  if (!commit) {
    console.log('\nSimulacion completa. Revisa los numeros antes de --commit.');
    return;
  }

  console.log('\nClaims reemitidos.');
  if (revokeSessions) {
    console.log(
      'Sesiones revocadas: los usuarios deben volver a autenticarse.',
    );
    console.log('SIGUIENTE: registrar TenantGuard en AppModule.');
  } else {
    console.log(
      'Los ID tokens ya emitidos siguen validos hasta 1 hora. Espera ese plazo',
    );
    console.log(
      '(o volve a correr con --revoke-sessions) antes de registrar TenantGuard.',
    );
  }
}

main().catch((error) => {
  console.error('\nRe-emision abortada:', error.message);
  process.exit(1);
});
