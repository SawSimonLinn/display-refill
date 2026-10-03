/**
 * JSON naming convention for every HTTP payload, fixture and persisted JSON
 * document: object keys are lower snake_case (`slot_id`, `expected_revision`).
 * TypeScript schemas declare the wire names directly; Swift uses explicit
 * CodingKeys. Nothing converts camelCase implicitly.
 */
export const SNAKE_CASE_KEY = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;

/** Returns JSON paths of object keys that break the snake_case convention. */
export function findNonSnakeCaseKeys(value: unknown, path = "$"): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => findNonSnakeCaseKeys(item, `${path}[${index}]`));
  }
  if (value !== null && typeof value === "object") {
    return Object.entries(value).flatMap(([key, child]) => {
      const childPath = `${path}.${key}`;
      const own = SNAKE_CASE_KEY.test(key) ? [] : [childPath];
      // field_errors is keyed by caller-supplied field paths, which follow the
      // same convention but may contain array indexes such as items.0.quantity.
      if (key === "field_errors") return own;
      return [...own, ...findNonSnakeCaseKeys(child, childPath)];
    });
  }
  return [];
}
