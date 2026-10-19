// Step-driven number formatting, shared by slider readouts AND export literals.

/** Decimal places the step is written with (0.25 → 2, 2.5 → 1, 10 → 0), so
 *  every multiple of it formats exactly. */
export function decimals(step: number): number {
  if (!(step > 0)) return 0;
  const [mantissa, exponent] = step.toExponential().split('e');
  return Math.max(0, (mantissa.split('.')[1]?.length ?? 0) - Number(exponent));
}

/** Display string at step precision. */
export function formatNumber(v: number, step: number): string {
  return v.toFixed(decimals(step));
}

/** Export literal at step precision — kills 0.30000000000000004. */
export function numberToLiteral(v: number, step: number): string {
  return Number(v.toFixed(decimals(step))).toString();
}
