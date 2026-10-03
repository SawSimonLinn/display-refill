import { type VisionResponseV1, VisionResponseV1 as VisionResponseSchema } from "@display-refill/domain";
import mixedFixture from "@display-refill/domain/fixtures/vision/response-v1.mixed.json";

/**
 * Provider boundary from context/vision-contract.md. Adapters return the raw
 * provider payload; callers always run it through the strict validator, so a
 * misbehaving provider (or mock) cannot bypass schema checks.
 */
export interface VisionRequest {
  scan_id: string;
  /** Pinned slot IDs, in POG order. */
  slot_ids: readonly string[];
}

export interface VisionAdapter {
  readonly provider: string;
  analyze(request: VisionRequest, signal?: AbortSignal): Promise<unknown>;
}

export class VisionOutputInvalidError extends Error {
  constructor(readonly issueCount: number) {
    super(`Vision output failed schema validation (${issueCount} issue(s)).`);
    this.name = "VisionOutputInvalidError";
  }
}

export function validateVisionOutput(raw: unknown): VisionResponseV1 {
  const result = VisionResponseSchema.safeParse(raw);
  if (!result.success) throw new VisionOutputInvalidError(result.error.issues.length);
  return result.data;
}

/**
 * Deterministic offline adapter used in development and CI. It maps the fixed
 * fixture's slot observations onto the requested slot IDs in order, cycling
 * when there are more slots, so callers see both a known count and an unknown
 * occluded slot. It never calls the network.
 */
export class MockVisionAdapter implements VisionAdapter {
  readonly provider = "mock";

  async analyze(request: VisionRequest, signal?: AbortSignal): Promise<unknown> {
    signal?.throwIfAborted();
    const template = validateVisionOutput(mixedFixture);
    return {
      ...template,
      slots: request.slot_ids.map((slot_id, index) => ({
        ...template.slots[index % template.slots.length]!,
        slot_id,
      })),
    };
  }
}

export function createVisionAdapter(provider: "mock"): VisionAdapter {
  switch (provider) {
    case "mock":
      return new MockVisionAdapter();
  }
}
