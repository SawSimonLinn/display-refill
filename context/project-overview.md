# Display Case Refill Scanner MVP

## Overview
An employee selects a store and display, takes or uploads one photograph, checks estimated counts, and receives a refill list calculated against a configured planogram (POG). Managers configure the five or six display layouts in a web dashboard. The app supports manual counting when a photo or AI is unsuitable.

## Goals
1. Replace memory-based display checks with repeatable, configurable POG checks.
2. Make capture, verification, and refill calculation understandable to employees.
3. Keep uncertain or hidden quantities explicit; never turn unknown into zero.
4. Preserve original detections and human corrections for evaluation and potential future training.
5. Deliver a useful manual workflow before introducing AI.

## Core User Flow
1. Sign in with Supabase Auth (email/password).
2. Select an assigned store and active display with a published POG.
3. Capture/import a photo and align its display crop, or choose manual counts.
4. Submit; the server pins the POG version and queues analysis.
5. Review counts, resolve every uncertain slot, and correct mistakes.
6. Confirm; the server freezes a refill list for that review revision.
7. Prepare/refill items and record completion as an employee attestation.
8. Reopen the historical scan with its original configuration and audit trail.

## Features
- SwiftUI employee app with camera, photo import, results, correction, manual mode, and history.
- Next.js/TypeScript dashboard with stores, displays, products, POG editor, memberships, and scan review.
- Supabase Auth, Postgres with RLS, and private Storage.
- Server-side multimodal vision adapter returning counts and quality flags.
- Server-owned threshold-aware refill engine, confidence review, and durable scan processing.

## Scope
MVP includes one organization initially, multiple stores in its data model, employee/manager/admin access, one photograph per scan, rectangular POG slots, immutable published versions, correction capture, and history. Store selection and display selection are explicit.

Out of scope: live AR/video, automatic display recognition, custom model training, inventory/POS integrations, forecasting, automatic ordering, billing, social collaboration, live cursors, push notifications, offline AI or durable offline sync, employee performance scoring, and production quantity optimization.

## Success Criteria
Pilot first at one store with one display, then expand to all five or six layouts. Target at least 85% exact visible-slot count accuracy on a held-out set; separately measure unknown rate and hidden-stock failures. Refill arithmetic must pass all deterministic tests. Target median end-to-end employee workflow under 30 seconds and p95 queued-to-result time under 15 seconds on pilot Wi-Fi; these are targets, not measured claims or guarantees. All unresolved counts must block confirmation. Manual fallback must work without the vision provider, but still requires backend connectivity.

## Terminology
- POG: versioned layout, products, slot coordinates, target counts, and trigger rules.
- Slot: one nonoverlapping rectangular area assigned to one expected product.
- Current count: accepted quantity of the expected product in that slot, not total containers of any kind.
- Refill: recommendation to bring an eligible slot to target; not an inventory order.
- Confirmed: user accepted counts. Completed: user attested that the confirmed refill task was done.
