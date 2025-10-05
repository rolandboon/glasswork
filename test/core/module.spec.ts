import { describe, expect, it } from 'vitest';
import { defineModule } from '../../src/core/module.js';

describe('defineModule', () => {
  it('should define a valid module', () => {
    const module = defineModule({
      name: 'test',
      providers: [],
    });

    expect(module.name).toBe('test');
    expect(module.providers).toEqual([]);
  });

  it('should throw when module name is missing', () => {
    expect(() =>
      defineModule({
        name: '',
        providers: [],
      })
    ).toThrow('Module name is required');
  });

  it('should throw when module name contains slash', () => {
    expect(() =>
      defineModule({
        name: 'test/module',
        providers: [],
      })
    ).toThrow('Module name must not contain "/" or spaces');
  });

  it('should throw when module name contains spaces', () => {
    expect(() =>
      defineModule({
        name: 'test module',
        providers: [],
      })
    ).toThrow('Module name must not contain "/" or spaces');
  });

  it('should accept class providers', () => {
    class TestService {}

    const module = defineModule({
      name: 'test',
      providers: [TestService],
    });

    expect(module.providers).toContain(TestService);
  });

  it('should accept explicit provider config', () => {
    class TestService {}

    const module = defineModule({
      name: 'test',
      providers: [
        {
          provide: 'testService',
          useClass: TestService,
          scope: 'SINGLETON',
        },
      ],
    });

    expect(module.providers).toHaveLength(1);
  });

  it('should validate exports reference existing providers', () => {
    class TestService {}

    expect(() =>
      defineModule({
        name: 'test',
        providers: [TestService],
        exports: ['NonExistent'],
      })
    ).toThrow('exports "NonExistent" but it\'s not in providers');
  });

  it('should allow valid exports', () => {
    class TestService {}

    const module = defineModule({
      name: 'test',
      providers: [TestService],
      exports: [TestService],
    });

    expect(module.exports).toContain(TestService);
  });
});
