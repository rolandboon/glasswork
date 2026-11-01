/**
 * A maintenance command on the same runtime as the API and the worker:
 *
 *   node dist/src/cli.js place-order --tenant tenant-a --actor support-1 --sku widget --quantity 2
 *
 * It validates its input at the edge, runs one use case in its own scope and stops the
 * runtime, also after a failure. Exit codes: 0 done, 1 the use case or shutdown failed,
 * 2 invalid input.
 */
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { bootstrapRuntime, type RuntimeBootstrapResult } from 'glasswork/core';
import * as v from 'valibot';
import { OrdersModule, type OrderTransactions } from './orders/orders.module.js';

const PlaceOrderArgs = v.object({
  tenant: v.pipe(v.string(), v.minLength(1)),
  actor: v.pipe(v.string(), v.minLength(1)),
  sku: v.pipe(v.string(), v.minLength(1)),
  quantity: v.pipe(v.string(), v.transform(Number), v.integer(), v.minValue(1)),
});

const usage = 'Usage: cli place-order --tenant <id> --actor <user> --sku <sku> --quantity <n>';

interface Output {
  out(line: string): void;
  error(line: string): void;
}

export async function main(argv: string[], io: Output = defaultOutput): Promise<number> {
  let parsed: ReturnType<typeof parseCommand>;
  try {
    parsed = parseCommand(argv);
  } catch (error) {
    io.error(`${error instanceof Error ? error.message : String(error)}\n${usage}`);
    return 2;
  }
  const { positionals, values } = parsed;
  if (positionals[0] !== 'place-order') {
    io.error(usage);
    return 2;
  }
  const args = v.safeParse(PlaceOrderArgs, values);
  if (!args.success) {
    io.error(`Invalid input: ${v.summarize(args.issues)}\n${usage}`);
    return 2;
  }

  let runtime: RuntimeBootstrapResult | undefined;
  let exitCode = 0;
  try {
    // Only the orders module and its imports: the command cannot reach other modules.
    runtime = await bootstrapRuntime(OrdersModule);
    await runtime.start();
    const order = await runtime.withScope(({ orderTransactions }) =>
      (orderTransactions as OrderTransactions).placeOrder({
        tenantId: args.output.tenant,
        actorUserId: args.output.actor,
        sku: args.output.sku,
        quantity: args.output.quantity,
      })
    );
    io.out(JSON.stringify({ id: order.id, number: order.number }));
  } catch (error) {
    io.error(`place-order failed: ${error instanceof Error ? error.message : String(error)}`);
    exitCode = 1;
  }
  try {
    await runtime?.stop();
  } catch (error) {
    io.error(`Shutdown failed: ${error instanceof Error ? error.message : String(error)}`);
    exitCode = 1;
  }
  return exitCode;
}

function parseCommand(argv: string[]) {
  return parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      tenant: { type: 'string' },
      actor: { type: 'string' },
      sku: { type: 'string' },
      quantity: { type: 'string' },
    },
  });
}

const defaultOutput: Output = {
  out: (line) => console.log(line),
  error: (line) => console.error(line),
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
