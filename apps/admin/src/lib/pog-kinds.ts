import type { PogKind } from "@display-refill/domain";

/** Display names for POG kinds, in the order the store sections are walked. */
export const POG_KIND_LABELS: Record<PogKind, string> = {
  fruit_mobile: "M1 bunker (fruit)",
  salad_mobile: "Salad destination",
  fruit_case: "6ft fruit",
  veggie_case: "Veggie display case",
};

export const POG_KINDS = Object.keys(POG_KIND_LABELS) as PogKind[];

export const pogKindLabel = (kind: PogKind | null) => (kind ? POG_KIND_LABELS[kind] : "No kind");

export const pogKindOptions = POG_KINDS.map((k) => ({ value: k, label: POG_KIND_LABELS[k] }));
