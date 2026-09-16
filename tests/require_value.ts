/** Fail at the missing test prerequisite instead of masking it with a TS assertion. */
export function requireValue<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) {
    throw new Error(`Missing ${label}`);
  }
  return value;
}
