import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Secure test-secret store for the multi-agent suite. It lives OUTSIDE the repository (default: ~/.inok-test-secrets), is never
// committed and is never printed. It holds only staging-only synthetic persona passwords and TOTP seeds.
export type PersonaKey = 'buyerA' | 'buyerB' | 'seller' | 'supplier' | 'admin' | 'admin2';
export interface StoredPersona { id: string; email: string; password: string; totpSecret?: string; orgId?: string }
export interface Store {
  personas: Partial<Record<PersonaKey, StoredPersona>>;
  data: Record<string, string>; // shared ids between scenarios (enquiry id, request id, ...)
}

const dir = process.env.INOK_TEST_SECRETS_DIR ?? path.join(os.homedir(), '.inok-test-secrets');
const file = path.join(dir, 'staging-agents.json');

export function loadStore(): Store {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as Store;
  } catch {
    return { personas: {}, data: {} };
  }
}

export function saveStore(s: Store): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(s, null, 2), { mode: 0o600 });
}

export function setData(key: string, value: string): void {
  const s = loadStore();
  s.data[key] = value;
  saveStore(s);
}
export const getData = (key: string): string | undefined => loadStore().data[key];

export function persona(key: PersonaKey): StoredPersona {
  const p = loadStore().personas[key];
  if (!p) throw new Error(`Persona ${key} is not provisioned: run 00-provision first`);
  return p;
}
