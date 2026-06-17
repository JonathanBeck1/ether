// Step-driven number formatting, shared by slider readouts AND export literals.

/** Decimal places implied by a step, derived generically (no hardcoded table). */
export function decimals(step: number): number {
  if (!(step > 0)) return 0;
  return Math.max(0, -Math.floor(Math.log10(step)));
}

/** Display string at step precision. */
export function formatNumber(v: number, step: number): string {
  return v.toFixed(decimals(step));
}

/** Export literal at step precision — kills 0.30000000000000004. */
export function numberToLiteral(v: number, step: number): string {
  return Number(v.toFixed(decimals(step))).toString();
}
