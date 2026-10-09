import type { PogKind } from "@display-refill/domain";

/** Names of the four standard display case types, in the order the store sections are walked. */
const POG_KIND_LABELS: Record<string, string> = {
  fruit_mobile: "M1 bunker (fruit)",
  salad_mobile: "Salad destination",
  fruit_case: "6ft fruit",
  veggie_case: "Veggie display case",
};

export const POG_KINDS = Object.keys(POG_KIND_LABELS) as PogKind[];

/** Types added by admins (Feature 16) show their code until the forms read names from the type list. */
export const pogKindLabel = (kind: PogKind | null): string => (kind ? POG_KIND_LABELS[kind] ?? kind : "No kind");

export const pogKindOptions = POG_KINDS.map((k) => ({ value: k, label: pogKindLabel(k) }));
