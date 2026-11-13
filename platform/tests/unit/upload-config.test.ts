import { describe, expect, it } from 'vitest';
import { MAX_UPLOAD_BYTES } from '@/lib/upload';
import { read } from './helpers';

const MIB = 1024 * 1024;

/** Parses '16mb' style values as Next does (1 mb = 1024 * 1024 bytes). */
function bytes(v: string): number {
  const m = v.match(/^(\d+)\s*(b|kb|mb|gb)$/i)!;
  const unit = { b: 1, kb: 1024, mb: MIB, gb: 1024 * MIB }[m[2].toLowerCase() as 'b' | 'kb' | 'mb' | 'gb'];
  return Number(m[1]) * unit;
}

describe('upload size limits stay consistent (D3)', () => {
  const config = read('next.config.ts');
  const action = config.match(/bodySizeLimit:\s*'([^']+)'/)![1];
  const proxy = config.match(/proxyClientMaxBodySize:\s*'([^']+)'/)![1];

  it('the app limit is exactly 10 MiB', () => {
    expect(MAX_UPLOAD_BYTES).toBe(10 * MIB);
  });

  it('server-action and proxy body limits both exceed the file limit plus multipart overhead', () => {
    const overhead = 1 * MIB;
    expect(bytes(action)).toBeGreaterThanOrEqual(MAX_UPLOAD_BYTES + overhead);
    expect(bytes(proxy)).toBeGreaterThanOrEqual(MAX_UPLOAD_BYTES + overhead);
  });

  it('the proxy never buffers less than the server action accepts (no silent truncation)', () => {
    expect(bytes(proxy)).toBeGreaterThanOrEqual(bytes(action));
  });

  it('the action still rejects oversize files with its own message', () => {
    const upload = read('src/app/[locale]/orgs/[id]/business/actions.ts');
    expect(upload).toContain('file.size > MAX_UPLOAD_BYTES');
    expect(upload).toContain("failure('file_too_large')");
    expect(upload).toContain("'too_large'");
  });
});
