import { describe, expect, it } from 'vitest';
// @ts-expect-error the gate is a plain ESM script (scripts/audit-gate.mjs) without type declarations
import { EXCEPTIONS, evaluateAudit } from '../../scripts/audit-gate.mjs';

const PICO = 'https://github.com/advisories/GHSA-fc5q-39xc-vjpf';
const OTHER = 'https://github.com/advisories/GHSA-aaaa-bbbb-cccc';
const adv = (url: string, severity = 'high', name = 'picomatch') => ({ source: 1, name, title: 't', url, severity, range: '<=4.0.7' });
const report = (vulnerabilities: Record<string, unknown>) => ({ auditReportVersion: 2, vulnerabilities, metadata: { vulnerabilities: {} } });
const TODAY = '2026-11-18';

describe('audit gate (dependency audit exception)', () => {
  it('excuses the approved picomatch advisory, including packages that only depend on it', () => {
    const r = evaluateAudit(
      report({
        picomatch: { severity: 'high', via: [adv(PICO)] },
        tinyglobby: { severity: 'high', via: ['picomatch'] },
        vitest: { severity: 'high', via: ['tinyglobby'] },
      }),
      TODAY,
    );
    expect(r.ok).toBe(true);
    expect(r.excused.length).toBe(1);
  });

  it('fails for any other high advisory, even on the same package', () => {
    const r = evaluateAudit(report({ picomatch: { severity: 'high', via: [adv(PICO), adv(OTHER)] } }), TODAY);
    expect(r.ok).toBe(false);
    expect(r.failures.join(' ')).toContain('GHSA-aaaa-bbbb-cccc');
  });

  it('fails for a critical advisory elsewhere', () => {
    expect(evaluateAudit(report({ lodash: { severity: 'critical', via: [adv(OTHER, 'critical', 'lodash')] } }), TODAY).ok).toBe(false);
  });

  it('ignores moderate and low advisories (same level as `npm audit --audit-level=high`)', () => {
    expect(evaluateAudit(report({ glob: { severity: 'moderate', via: [adv(OTHER, 'moderate', 'glob')] } }), TODAY).ok).toBe(true);
  });

  it('stops excusing the advisory on the expiry date', () => {
    const exp = EXCEPTIONS.find((e: { id: string }) => e.id === 'GHSA-fc5q-39xc-vjpf');
    expect(exp.expires).toBe('2027-01-15');
    const rep = report({ picomatch: { severity: 'high', via: [adv(PICO)] } });
    expect(evaluateAudit(rep, '2027-01-14').ok).toBe(true);
    const onDay = evaluateAudit(rep, '2027-01-15');
    expect(onDay.ok).toBe(false);
    expect(onDay.notes.join(' ')).toContain('EXPIRED');
    expect(evaluateAudit(rep, '2027-02-01').ok).toBe(false);
  });

  it('fails closed on a report it cannot validate', () => {
    expect(() => evaluateAudit(null, TODAY)).toThrow();
    expect(() => evaluateAudit({}, TODAY)).toThrow();
    expect(() => evaluateAudit({ auditReportVersion: 1, vulnerabilities: {}, metadata: {} }, TODAY)).toThrow();
    expect(() => evaluateAudit({ auditReportVersion: 2, vulnerabilities: {} }, TODAY)).toThrow();
    expect(() => evaluateAudit(report({ x: { severity: 'high', via: [{ title: 'no url' }] } }), TODAY)).toThrow();
    expect(() => evaluateAudit(report({}), 'not-a-date')).toThrow();
  });

  it('fails a high finding that has no advisory behind it', () => {
    expect(evaluateAudit(report({ mystery: { severity: 'high', via: [] } }), TODAY).ok).toBe(false);
  });
});
