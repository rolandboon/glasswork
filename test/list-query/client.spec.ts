import { describe, expect, it } from 'vitest';
import {
  createListQueryClient,
  encodeFilter,
  joinFilters,
  listSearchString,
  toggleListSort,
} from '../../src/list-query/client.js';
import { parseFilters } from '../../src/list-query/parser.js';

describe('browser list-query protocol', () => {
  const client = createListQueryClient({ pageSizes: [10, 25, 50, 100], defaultPageSize: 10 });
  const defaults = { sorts: 'name' };
  it('bounds external URL values and preserves application parameters during pagination', () => {
    expect(
      client.read(
        new URLSearchParams(`page=Infinity&pageSize=10000&search=${'a'.repeat(300)}`),
        defaults
      )
    ).toMatchObject({ page: 1, pageSize: 10, search: 'a'.repeat(255) });
    const params = new URLSearchParams(
      'page=3&pageSize=25&sorts=-name&search=CWZ&period=30&period=60'
    );
    const next = client.update(params, { page: 4 }, defaults);
    expect(next.getAll('period')).toEqual(['30', '60']);
    expect(client.query(client.read(next, defaults))).toEqual({
      page: 4,
      pageSize: 25,
      sorts: '-name',
      search: 'CWZ',
    });
    expect(params.get('page')).toBe('3');
    expect(client.read(client.update(params, { search: 'other' }, defaults), defaults).page).toBe(
      1
    );
    expect(
      listSearchString(
        client.update(params, { page: 1, pageSize: 10, sorts: 'name', search: '' }, defaults)
      )
    ).toBe('?period=30&period=60');
    expect(toggleListSort('name', 'name')).toBe('-name');
  });

  it('round-trips scalar separators, backslashes and operator text through the server parser', () => {
    for (const value of [
      'comma,value',
      'pipe|value',
      'back\\slash',
      'slash\\,comma',
      'null',
      '\\null',
      'a!=b>=c@=d',
    ]) {
      const filters = joinFilters([
        encodeFilter('name', '==', value),
        encodeFilter('active', '==', true),
      ]);
      expect(parseFilters(filters)).toEqual([
        { fieldPath: ['name'], operator: '==', value },
        { fieldPath: ['active'], operator: '==', value: 'true' },
      ]);
    }
    expect(() => encodeFilter('name,role', '==', 'value')).toThrow();
    expect(() => encodeFilter('name', '@=|', 'a|b')).toThrow();
  });
});
