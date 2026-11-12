'use client';

import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { COMPARE_LIMIT } from './helpers';

/**
 * The compare selection lives in sessionStorage of this browser tab (product ids and public product names only: no personal data,
 * no cookie). It survives moving between catalogue pages and is gone when the tab closes. When storage is not available it falls
 * back to memory for the page's lifetime.
 */
export interface CompareEntry {
  id: string;
  name: string;
}

const KEY = 'mitra.catalogue.compare.v1';
const EVENT = 'mitra:compare-change';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let memory = '[]';

function readRaw(): string {
  try {
    return window.sessionStorage.getItem(KEY) ?? '[]';
  } catch {
    return memory;
  }
}
function writeRaw(raw: string) {
  memory = raw;
  try {
    window.sessionStorage.setItem(KEY, raw);
  } catch {
    /* storage blocked: memory only */
  }
  window.dispatchEvent(new Event(EVENT));
}

export function parseEntries(raw: string): CompareEntry[] {
  try {
    const v = JSON.parse(raw) as unknown;
    if (!Array.isArray(v)) return [];
    const out: CompareEntry[] = [];
    for (const e of v) {
      if (e && typeof e === 'object' && typeof (e as CompareEntry).id === 'string' && UUID.test((e as CompareEntry).id) && !out.some((x) => x.id === (e as CompareEntry).id)) {
        out.push({ id: (e as CompareEntry).id, name: String((e as CompareEntry).name ?? '').slice(0, 160) });
      }
      if (out.length >= COMPARE_LIMIT) break;
    }
    return out;
  } catch {
    return [];
  }
}

const subscribe = (cb: () => void) => {
  window.addEventListener(EVENT, cb);
  window.addEventListener('storage', cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener('storage', cb);
  };
};

export function useCompareSelection() {
  const raw = useSyncExternalStore(subscribe, readRaw, () => '[]');
  const entries = useMemo(() => parseEntries(raw), [raw]);
  const toggle = useCallback((e: CompareEntry): 'added' | 'removed' | 'full' => {
    const cur = parseEntries(readRaw());
    if (cur.some((x) => x.id === e.id)) {
      writeRaw(JSON.stringify(cur.filter((x) => x.id !== e.id)));
      return 'removed';
    }
    if (cur.length >= COMPARE_LIMIT) return 'full';
    writeRaw(JSON.stringify([...cur, e]));
    return 'added';
  }, []);
  const remove = useCallback((id: string) => writeRaw(JSON.stringify(parseEntries(readRaw()).filter((x) => x.id !== id))), []);
  const clear = useCallback(() => writeRaw('[]'), []);
  const replace = useCallback((list: CompareEntry[]) => writeRaw(JSON.stringify(list.slice(0, COMPARE_LIMIT))), []);
  return { entries, toggle, remove, clear, replace, full: entries.length >= COMPARE_LIMIT };
}
