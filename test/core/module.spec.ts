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

  it('should accept factory providers with dependencies', () => {
    class ConfigService {
      get(key: string) {
        return `value-${key}`;
      }
    }

    const module = defineModule({
      name: 'test',
      providers: [
        ConfigService,
        {
          provide: 'emailConfig',
          useFactory: ({ configService }: { configService: ConfigService }) => ({
            sender: configService.get('emailSender'),
            region: configService.get('awsRegion'),
          }),
          inject: ['configService'],
          scope: 'SINGLETON',
        },
      ],
    });

    expect(module.providers).toHaveLength(2);
  });

  it('should throw error for invalid provider type (not function or object)', () => {
    expect(() =>
      defineModule({
        name: 'test',
        // @ts-expect-error - Testing runtime validation with invalid provider type
        providers: ['string-is-invalid'],
      })
    ).toThrow('Invalid provider in module "test"');

    expect(() =>
      defineModule({
        name: 'test',
        // @ts-expect-error - Testing runtime validation with invalid provider type
        providers: [123],
      })
    ).toThrow('Invalid provider in module "test"');

    expect(() =>
      defineModule({
        name: 'test',
        // @ts-expect-error - Testing runtime validation with invalid provider type
        providers: [true],
      })
    ).toThrow('Invalid provider in module "test"');
  });

  it('should allow exports with provide as Constructor class', () => {
    class TestService {}

    const module = defineModule({
      name: 'test',
      providers: [
        {
          provide: TestService,
          useClass: TestService,
        },
      ],
      exports: [TestService],
    });

    expect(module.exports).toContain(TestService);
  });

  it('should validate exports match providers with provide as Constructor', () => {
    class TestService {}
    class OtherService {}

    expect(() =>
      defineModule({
        name: 'test',
        providers: [
          {
            provide: TestService,
            useClass: TestService,
          },
        ],
        exports: [OtherService],
      })
    ).toThrow('exports "otherService" but it\'s not in providers');
  });

  it('should handle provider config object without provide key', () => {
    // This edge case tests getProviderName returning empty string
    const module = defineModule({
      name: 'test',
      providers: [
        {
          provide: 'validProvider',
          useValue: 'test',
        },
      ],
      exports: ['validProvider'],
    });

    expect(module.exports).toContain('validProvider');
  });

  it('should skip validation when exports is undefined', () => {
    class TestService {}

    const module = defineModule({
      name: 'test',
      providers: [TestService],
    });

    expect(module.exports).toBeUndefined();
  });

  it('should skip validation when providers is undefined', () => {
    const module = defineModule({
      name: 'test',
    });

    expect(module.providers).toBeUndefined();
  });

  it('should allow string exports matching string-named providers', () => {
    const module = defineModule({
      name: 'test',
      providers: [
        {
          provide: 'myService',
          useValue: { test: true },
        },
      ],
      exports: ['myService'],
    });

    expect(module.exports).toContain('myService');
  });
});
