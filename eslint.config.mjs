// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['eslint.config.mjs'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'commonjs',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      "prettier/prettier": ["error", { endOfLine: "auto" }],
      // Convención de descarte explícito: `const { hash: _hash, ...rest } = x`
      // es la forma idiomática de omitir claves en TypeScript. El prefijo `_`
      // declara la intención de no usar la variable.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          varsIgnorePattern: '^_',
          argsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  {
    // Scripts de Node en JS plano (fuera del build de Nest): no forman parte
    // del tsconfig del proyecto, así que quedan fuera del linting con tipos.
    // Usan CommonJS porque corren directo con `node` sin paso de build.
    files: ['scripts/**/*.js'],
    ...tseslint.configs.disableTypeChecked,
    rules: {
      ...tseslint.configs.disableTypeChecked.rules,
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    // ── Ratchet de aislamiento entre concesionarios ──────────────────────
    //
    // Prohíbe el acceso directo a Firestore fuera de la capa de repositorios.
    // Sin esto, el aislamiento dependería de que cada desarrollador se
    // acuerde de escribir un `where('tenantId', ...)` — y el scoping por
    // `sede` que ya existe demuestra que esa disciplina no se sostiene: está
    // aplicado a mano y de forma inconsistente en ~10 lugares.
    //
    // `ignores` es la lista de módulos AÚN NO MIGRADOS. Cada PR que migra un
    // módulo a TenantScopedRepository lo borra de esta lista. La lista
    // encogiendo es la métrica de avance; nadie puede introducir una
    // violación nueva en un módulo ya migrado.
    //
    // Ver docs/design/01-multi-tenancy.md D-105.
    files: ['src/**/*.ts'],
    ignores: [
      // ── Acceso crudo legítimo y PERMANENTE ──────────────────────────────
      // Estas rutas nunca salen de la lista: su acceso sin scope es correcto
      // por diseño, no deuda pendiente.
      'src/common/repositories/**',
      'src/firebase/**',
      // audit y tenants son las colecciones que DEFINEN el scope; filtrarlas
      // por tenantId no tendría sentido.
      'src/modules/audit/**',
      'src/modules/tenants/**',
      // auth corre ANTES de que exista contexto de tenant: el login y el
      // refresh no tienen usuario resuelto todavía. Su aislamiento no viene
      // de where('tenantId') sino de que la identidad ya está verificada
      // antes de tocar Firestore. Ver src/modules/auth/refresh-token.repository.ts.
      'src/modules/auth/**',
      // ── Pendientes de migrar ────────────────────────────────────────────
      // Borrar de esta lista al migrar cada uno. La lista encogiendo es la
      // métrica de avance.
      // Migrados: appointments, catalogs, certifications, delivery,
      // documentation, notifications, reports, service-orders, users.
      // home NUNCA estuvo en deuda: es un agregador puro que delega en
      // VehiclesService/ServiceOrdersService/NotificationsService, sin tocar
      // Firestore directo. Se sacó de esta lista sin ningún cambio de código.
      'src/modules/seed/**',
      'src/modules/vehicles/**',
      // Los specs mockean FirebaseService; no consultan Firestore de verdad.
      'src/**/*.spec.ts',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.property.name=/^(firestore|rawFirestore)$/]",
          message:
            'Acceso directo a Firestore prohibido fuera de la capa de repositorios. ' +
            'Usá un TenantScopedRepository; si necesitás cruzar concesionarios, runAsPlatform().',
        },
      ],
    },
  },
);
