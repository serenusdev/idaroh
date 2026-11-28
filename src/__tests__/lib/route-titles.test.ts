import { describe, expect, it } from 'vitest';
import { getRouteTitle } from '@/components/layout/route-titles';

describe('route title registry', () => {
  it('uses the longest matching prefix', () => {
    expect(getRouteTitle('/admin/live-telemetry/details')).toBe('Telemetry Langsung');
    expect(getRouteTitle('/admin/users/123')).toBe('Manajemen Pengguna');
  });

  it('covers the rebranded routes', () => {
    expect(getRouteTitle('/mutabaah')).toBe("Mutaba'ah & Halaqah");
    expect(getRouteTitle('/tasrih')).toBe('E-Tasrih');
    expect(getRouteTitle('/rapor/term-1')).toBe('Rapor Digital');
    expect(getRouteTitle('/admin/live-telemetry')).toBe('Telemetry Langsung');
  });

  it('uses IDAROH as the fallback', () => {
    expect(getRouteTitle('/rute-tidak-dikenal')).toBe('IDAROH');
  });
});
