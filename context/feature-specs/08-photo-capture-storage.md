# Photo Capture, Import and Storage

## Status
Implemented; acceptance incomplete. Backend tests and the simulator import/crop/upload/finalize flow pass (after crash fix A05); real-device camera capture, permission denial and background recovery remain unverified (progress-tracker.md).

## Dependencies
Feature(s): 07. Read the linked domain contracts through the README before implementation.

## Goal and Scope
Add AVFoundation capture and PhotosUI import. Explain framing, show reference aspect/outline, and let user retake or adjust a canonical display crop. Normalize orientation and transcode HEIC to JPEG, strip EXIF, compress within limits. Create scan with idempotency key, upload to server-generated private path, then finalize and enqueue. Keep camera-denied, upload-failed and poor-photo paths usable through manual mode. Do not claim basic brightness/blur checks prove countability.

## Acceptance Criteria
- Camera/import both produce upright validated images; orientation fixture coverage exists.
- Crop coordinates exclude preview letterboxing and agree with backend coordinates.
- Interrupted finalize retried with same key cannot enqueue duplicate work.
- Arbitrary URLs/paths, wrong ownership, oversized or malformed images are rejected.
- Photos are inaccessible anonymously; authorized preview expires.
- Real-device capture, permission-denied and app-background recovery are exercised.

## Verification and Handoff
Run relevant unit/integration/client tests from testing-and-acceptance.md, including authorization and failure paths. Record actual commands, observed results and unverified environments in progress-tracker.md. Update contracts when implementation decisions change. Do not mark complete until the criteria above are demonstrated.
