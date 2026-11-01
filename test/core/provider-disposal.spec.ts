import { describe, expect, it, vi } from 'vitest';
import { bootstrap } from '../../src/core/bootstrap.js';
import { defineModule } from '../../src/core/module.js';

class Connection {
  closed = false;
}

describe('provider dispose option', () => {
  it('disposes resolved class and factory providers when the application stops', async () => {
    const dispose = vi.fn();
    const { container, start, stop } = await bootstrap(
      defineModule({
        name: 'test',
        providers: [
          { provide: 'classConnection', useClass: Connection, dispose },
          { provide: 'factoryConnection', useFactory: () => new Connection(), dispose },
        ],
      }),
      { environment: 'test' }
    );
    await start();

    const instances = [
      container.resolve('classConnection'),
      container.resolve('factoryConnection'),
    ];
    await stop();
    await stop();

    expect(dispose).toHaveBeenCalledTimes(2);
    expect(dispose.mock.calls.map(([instance]) => instance)).toEqual(instances);
  });

  it('passes the resolved value of an async factory to its disposer', async () => {
    const dispose = vi.fn();
    const { container, stop } = await bootstrap(
      defineModule({
        name: 'test',
        providers: [{ provide: 'connection', useFactory: async () => new Connection(), dispose }],
      }),
      { environment: 'development' }
    );
    const connection = container.resolve('connection');

    await stop();

    expect(connection).toBeInstanceOf(Connection);
    expect(dispose).toHaveBeenCalledExactlyOnceWith(connection);
  });

  it('disposes scoped providers with their scope', async () => {
    const dispose = vi.fn();
    const { container } = await bootstrap(
      defineModule({
        name: 'test',
        providers: [
          { provide: 'connection', scope: 'SCOPED', useFactory: () => new Connection(), dispose },
        ],
      }),
      { environment: 'test' }
    );
    const scope = container.createScope();
    const connection = scope.resolve('connection');

    await scope.dispose();

    expect(dispose).toHaveBeenCalledExactlyOnceWith(connection);
  });

  it('does not create a provider only to dispose it', async () => {
    const factory = vi.fn(() => new Connection());
    const dispose = vi.fn();
    const { stop } = await bootstrap(
      defineModule({
        name: 'test',
        providers: [{ provide: 'connection', useFactory: factory, dispose }],
      }),
      { environment: 'test' }
    );

    await stop();

    expect(factory).not.toHaveBeenCalled();
    expect(dispose).not.toHaveBeenCalled();
  });
});
