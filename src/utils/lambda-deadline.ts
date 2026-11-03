/**
 * Time a handler may spend on telemetry before it returns: at most `maxMs`, and `marginMs`
 * short of the invocation's deadline when Lambda reports one.
 * @internal
 */
export function flushBudget(
  context: { getRemainingTimeInMillis?: () => number } | undefined,
  maxMs: number,
  marginMs: number
): number {
  const remaining = context?.getRemainingTimeInMillis?.();
  if (typeof remaining !== 'number' || !Number.isFinite(remaining)) return maxMs;
  return Math.max(0, Math.min(maxMs, remaining - marginMs));
}
