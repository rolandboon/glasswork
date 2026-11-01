---
description: Run a use case from a maintenance command or script on the same modules and providers as the API and the worker, with bootstrapRuntime.
---

# Command-Line Tasks

Maintenance commands, migrations and one-off scripts need the same services as the API: the same modules, providers and database adapters. `bootstrapRuntime()` builds them without an HTTP app. It is the same runtime that `bootstrap()` and `bootstrapWorker()` use, so module boundaries, provider overrides, async factories and the lifecycle behave identically.

::: warning Experimental
`bootstrapRuntime()` is experimental. Its shape may change in a minor release while the boundary between the runtime and its entry points settles.
:::

## A Command

The [reference consumer](https://github.com/rolandboon/glasswork/blob/main/fixtures/reference-consumer/src/cli.ts) places an order from the command line, with the use case that its HTTP route and its job also call:

```sh
node dist/src/cli.js place-order --tenant tenant-a --actor support-1 --sku widget --quantity 2
```

```typescript
import { bootstrapRuntime, type RuntimeBootstrapResult } from 'glasswork/core';

export async function main(argv: string[]): Promise<number> {
  const args = parsePlaceOrderArgs(argv); // tenant, actor and input, validated with Valibot
  if (!args) return 2;

  let runtime: RuntimeBootstrapResult | undefined;
  let exitCode = 0;
  try {
    // Only the orders module and its imports: the command cannot reach other modules.
    runtime = await bootstrapRuntime(OrdersModule);
    await runtime.start();
    const order = await runtime.withScope(({ orderTransactions }) =>
      (orderTransactions as OrderTransactions).placeOrder({
        tenantId: args.tenant,
        actorUserId: args.actor,
        sku: args.sku,
        quantity: args.quantity,
      })
    );
    console.log(JSON.stringify({ id: order.id, number: order.number }));
  } catch (error) {
    console.error(`place-order failed: ${(error as Error).message}`);
    exitCode = 1;
  }
  try {
    await runtime?.stop();
  } catch (error) {
    console.error(`Shutdown failed: ${(error as Error).message}`);
    exitCode = 1;
  }
  return exitCode;
}

process.exitCode = await main(process.argv.slice(2));
```

## What the Command Owns

| Concern | Who handles it |
| --- | --- |
| Tenant, actor and input | The command validates them at the edge, like a route validates its body and a job its payload. There is no request, so nothing is ambient |
| Which modules exist | The module passed to `bootstrapRuntime()`. Bootstrapping a feature module composes only that module and its imports |
| Start | `bootstrapRuntime()` starts the runtime outside the `test` environment, like `bootstrap()`. Calling `start()` again is harmless |
| One use case | `withScope()` opens a scope of the root module, passes its services and disposes the scope afterwards, also when the use case fails |
| Shutdown | `stop()` runs destroy hooks and disposers once and flushes the exception tracker. Call it in every outcome; the process then exits on its own |
| Exit code | The command. The reference uses 0 for done, 1 for a failed use case or shutdown, 2 for invalid input |
| Signals | The command, if it runs long enough to need them. Call `stop()` from a `SIGINT` or `SIGTERM` handler |

When start-up fails, for example in an `onModuleInit` hook or an async factory, `bootstrapRuntime()` rejects after it ran the destroy hooks and disposers of the providers it already created. Values passed in through `providerOverrides`, such as a client the caller manages, are borrowed and stay open.

## Testing a Command

Run the built command as a process, so the test also covers argument parsing, exit codes and a clean exit after `stop()`. The reference consumer checks that the order, its reservation, its audit rows and its event share one transaction, that a failed use case leaves nothing behind and exits with 1, and that invalid input exits with 2 before the runtime starts.
