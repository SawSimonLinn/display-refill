# Store, Display and Product Management

## Status
Implemented and verified against the local stack (database, API, web dashboard; browser pass in Chromium). Store/display lists, products and POG identities only: the POG editor, reference images and publication are feature 05, so published-version assignment was tested with synthetic published versions. No iOS client uses these routes yet (feature 07). Evidence and limitations: progress-tracker.md.

## Dependencies
Feature(s): 03. Read the linked domain contracts through the README before implementation.

## Goal and Scope
Admin creates stores (number/name/timezone), products (name/short name/category/container/SKU/PLU/UPC) and reusable POG identities. Managers create and manage displays only in assigned stores and assign published POGs. Admin has the same capability organization-wide. Lists support active/archived filters where authorized. Validate unique store numbers and clear required-field errors. Archive referenced entities instead of deleting. Prevent new scans for inactive stores/displays or absent POG assignment; preserve old history.

## Acceptance Criteria
- Admin configures two stores and sample products; manager only mutates assigned displays.
- Cross-organization POG assignment is rejected server-side.
- Empty states provide the next authorized action; unauthorized actions remain blocked via API.
- Archiving a display prevents new scans and preserves prior scan detail.
- Product rename does not alter existing scan name snapshots.
- Concurrent form edits return revision conflict instead of silent overwrite.

## Verification and Handoff
Run relevant unit/integration/client tests from testing-and-acceptance.md, including authorization and failure paths. Record actual commands, observed results and unverified environments in progress-tracker.md. Update contracts when implementation decisions change. Do not mark complete until the criteria above are demonstrated.
