import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  // Integration tests drive the untyped (no generated DB types) Supabase client; allow `any` there only.
  { files: ['tests/integration/**', 'tests/e2e/**/*.ts'], rules: { '@typescript-eslint/no-explicit-any': 'off' } },
  // Node build scripts are CommonJS by design.
  { files: ['scripts/**/*.cjs'], rules: { '@typescript-eslint/no-require-imports': 'off' } },
  globalIgnores(['.next/**', 'out/**', 'node_modules/**', 'next-env.d.ts', 'supabase/**', 'playwright-report/**', 'test-results/**']),
]);
