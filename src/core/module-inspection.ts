import { createLogger } from '../utils/logger.js';
import { getProviderName, resolveModule } from './module.js';
import { collectModules, validateNoCycles } from './module-graph.js';
import { ModuleRuntime } from './module-runtime.js';
import type { ModuleConfig, ProviderConfig } from './types.js';

export interface ModuleGraphProvider {
  name: string;
  kind: 'class' | 'factory' | 'value';
  /** Value providers have no Awilix lifetime. */
  scope: 'SINGLETON' | 'SCOPED' | 'TRANSIENT' | 'VALUE';
  /** Async factories are awaited during bootstrap. */
  async: boolean;
  exported: boolean;
  /** Dependencies declared with `inject`. Constructor dependencies are not analyzed. */
  inject: string[];
}

export interface ModuleGraphNode {
  name: string;
  basePath?: string;
  /** `deferred` marks a `forwardRef()` import. */
  imports: Array<{ module: string; deferred: boolean }>;
  /** Provider names the module exports, including re-exports of imported modules. */
  exports: string[];
  providers: ModuleGraphProvider[];
  jobs: string[];
  hasRoutes: boolean;
}

export interface ModuleGraph {
  root: string;
  modules: ModuleGraphNode[];
  /** Module cycles closed by `forwardRef()` imports, as module names from first to last. */
  cycles: string[][];
}

/**
 * Describe the module graph of an application without creating any provider.
 *
 * Runs the same checks as bootstrap: duplicate module and provider names, undeferred import
 * cycles, ambiguous imports, unknown exports and `inject` dependencies that a module cannot
 * see. It does not run factories, route factories or lifecycle hooks, so it needs no
 * database, network or credentials.
 */
export function inspectModuleGraph(root: ModuleConfig): ModuleGraph {
  const modules = collectModules(root);
  validateNoCycles(modules);
  const runtime = new ModuleRuntime(modules, createLogger('ModuleGraph', 'silent'));

  return {
    root: root.name,
    modules: modules.map((module) => {
      const exported = new Set(runtime.exportedNames(module));
      return {
        name: module.name,
        ...(module.basePath ? { basePath: module.basePath } : {}),
        imports: (module.imports ?? []).map((reference) => ({
          module: resolveModule(reference).name,
          deferred: 'forwardRef' in reference,
        })),
        exports: [...exported],
        providers: (module.providers ?? []).map((provider) => describeProvider(provider, exported)),
        jobs: (module.jobs ?? []).map((job) => job.name),
        hasRoutes: Boolean(module.routes),
      };
    }),
    cycles: findDeferredCycles(modules),
  };
}

function describeProvider(provider: ProviderConfig, exported: Set<string>): ModuleGraphProvider {
  const name = getProviderName(provider);
  const base = { name, exported: exported.has(name), inject: [] as string[] };
  if (typeof provider === 'function') {
    return { ...base, kind: 'class', scope: 'SINGLETON', async: false };
  }
  if ('useValue' in provider) {
    return { ...base, kind: 'value', scope: 'VALUE', async: false };
  }
  if ('useClass' in provider) {
    return { ...base, kind: 'class', scope: provider.scope ?? 'SINGLETON', async: false };
  }
  const declared = (provider as { async?: boolean }).async;
  return {
    ...base,
    kind: 'factory',
    scope: provider.scope ?? 'SINGLETON',
    async: declared ?? provider.useFactory.constructor.name === 'AsyncFunction',
    inject: provider.inject ?? [],
  };
}

/** Every deferred edge that leads back to its importer closes a deliberate cycle. */
function findDeferredCycles(modules: ModuleConfig[]): string[][] {
  const edges = new Map(
    modules.map((module) => [
      module.name,
      (module.imports ?? []).map((reference) => resolveModule(reference).name),
    ])
  );
  const cycles: string[][] = [];
  for (const module of modules) {
    for (const reference of module.imports ?? []) {
      if (!('forwardRef' in reference)) continue;
      const path = shortestPath(edges, resolveModule(reference).name, module.name);
      if (path) cycles.push([module.name, ...path]);
    }
  }
  return cycles;
}

function shortestPath(
  edges: Map<string, string[]>,
  from: string,
  to: string
): string[] | undefined {
  const previous = new Map<string, string | null>([[from, null]]);
  const queue = [from];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    if (current === to) {
      const path: string[] = [];
      for (let node: string | null | undefined = to; node; node = previous.get(node)) {
        path.unshift(node);
      }
      return path;
    }
    for (const next of edges.get(current) ?? []) {
      if (!previous.has(next)) {
        previous.set(next, current);
        queue.push(next);
      }
    }
  }
  return undefined;
}

/** Render a module graph as a Mermaid flowchart. Deferred imports use dotted arrows. */
export function moduleGraphToMermaid(graph: ModuleGraph): string {
  const ids = new Map(graph.modules.map((module, index) => [module.name, `m_${index}`]));
  const id = (name: string) => ids.get(name);
  const label = (name: string) =>
    name.replace(/[&<>"#\r\n]/g, (character) => `#${character.charCodeAt(0)};`);
  const lines = ['flowchart LR'];
  for (const module of graph.modules) {
    const providers = module.providers.length;
    lines.push(
      `  ${id(module.name)}["${label(module.name)}<br/>${providers} provider${providers === 1 ? '' : 's'}, ${module.exports.length} exported"]`
    );
  }
  for (const module of graph.modules) {
    for (const imported of module.imports) {
      lines.push(
        `  ${id(module.name)} ${imported.deferred ? '-.->' : '-->'} ${id(imported.module)}`
      );
    }
  }
  return lines.join('\n');
}
