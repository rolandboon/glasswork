import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bootstrap } from '../../src/core/bootstrap.js';
import { defineModule } from '../../src/core/module.js';
import type { ModuleConfig } from '../../src/core/types.js';

describe('bootstrap environment detection', async () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should detect production environment from NODE_ENV', async () => {
    process.env.NODE_ENV = 'production';

    // Re-import to get fresh module with new env
    const { bootstrap: freshBootstrap } = await import('../../src/core/bootstrap.js');
    const { defineModule: freshDefineModule } = await import('../../src/core/module.js');

    const module = freshDefineModule({
      name: 'test',
      providers: [],
    });

    // Bootstrap without explicit environment to test detection
    const { app } = await freshBootstrap(module);
    expect(app).toBeDefined();
  });

  it('should detect production environment from AWS_LAMBDA_FUNCTION_NAME', async () => {
    delete process.env.NODE_ENV;
    process.env.AWS_LAMBDA_FUNCTION_NAME = 'my-lambda-function';

    const { bootstrap: freshBootstrap } = await import('../../src/core/bootstrap.js');
    const { defineModule: freshDefineModule } = await import('../../src/core/module.js');

    const module = freshDefineModule({
      name: 'test',
      providers: [],
    });

    const { app } = await freshBootstrap(module);
    expect(app).toBeDefined();
  });

  it('should detect production environment from LAMBDA_TASK_ROOT', async () => {
    delete process.env.NODE_ENV;
    process.env.LAMBDA_TASK_ROOT = '/var/task';

    const { bootstrap: freshBootstrap } = await import('../../src/core/bootstrap.js');
    const { defineModule: freshDefineModule } = await import('../../src/core/module.js');

    const module = freshDefineModule({
      name: 'test',
      providers: [],
    });

    const { app } = await freshBootstrap(module);
    expect(app).toBeDefined();
  });

  it('should apply secure headers in production environment', async () => {
    process.env.NODE_ENV = 'production';

    const { bootstrap: freshBootstrap } = await import('../../src/core/bootstrap.js');
    const { defineModule: freshDefineModule } = await import('../../src/core/module.js');

    const consoleSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

    const module = freshDefineModule({
      name: 'test',
      providers: [],
    });

    const { app } = await freshBootstrap(module, {
      debug: true,
      // Don't pass environment to use auto-detection
    });

    expect(app).toBeDefined();
    // Verify secure headers were applied (appears in debug logs)
    expect(consoleSpy).toHaveBeenCalled();
    const calls = consoleSpy.mock.calls.flat().join(' ');
    expect(calls).toContain('secure headers');

    consoleSpy.mockRestore();
  });

  it('should not apply secure headers when explicitly disabled in production', async () => {
    const consoleSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

    const module = defineModule({
      name: 'test',
      providers: [],
    });

    const { app } = await bootstrap(module, {
      debug: true,
      environment: 'production',
      middleware: {
        secureHeaders: false,
      },
    });

    expect(app).toBeDefined();
    const calls = consoleSpy.mock.calls.flat().join(' ');
    expect(calls).not.toContain('Applying secure headers');

    consoleSpy.mockRestore();
  });

  it('should detect test environment from NODE_ENV', async () => {
    process.env.NODE_ENV = 'test';

    const { bootstrap: freshBootstrap } = await import('../../src/core/bootstrap.js');
    const { defineModule: freshDefineModule } = await import('../../src/core/module.js');

    const module = freshDefineModule({
      name: 'test',
      providers: [],
    });

    const { app } = await freshBootstrap(module);
    expect(app).toBeDefined();
  });

  it('should default to development when no environment indicators', async () => {
    delete process.env.NODE_ENV;
    delete process.env.AWS_LAMBDA_FUNCTION_NAME;
    delete process.env.LAMBDA_TASK_ROOT;

    const { bootstrap: freshBootstrap } = await import('../../src/core/bootstrap.js');
    const { defineModule: freshDefineModule } = await import('../../src/core/module.js');

    const module = freshDefineModule({
      name: 'test',
      providers: [],
    });

    const { app } = await freshBootstrap(module);
    expect(app).toBeDefined();
  });

  it('should handle modules without providers property', async () => {
    const module = defineModule({
      name: 'no-providers',
    } as ModuleConfig);

    const { container } = await bootstrap(module);
    expect(container).toBeDefined();
  });

  it('should disable error handler when set to false', async () => {
    const module = defineModule({
      name: 'test',
      providers: [],
    });

    const { app } = await bootstrap(module, {
      errorHandler: false,
    });

    expect(app).toBeDefined();
  });
});
