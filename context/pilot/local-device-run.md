# One store/display: local iPhone run sheet

Prepared 2026-10-03. **Acceptance incomplete.** Owner selected Mobile #1 fruit POG; the reference is preserved locally and [seven provisional product lanes](mobile-1-draft.md) await approval. One unit is **one sellable container**. Actual store, package sizes, targets and triggers remain unconfirmed. No real layout published; no paid calls, external photo transfer or hosted deployment.

## Selected POG draft

See [Mobile #1 product/slot draft](mobile-1-draft.md) and [preserved reference](references/mobile-1-fruit-pog.png). Blank triggers mean undecided, not approved always-top-up/null behavior. Device checks use separate synthetic fixtures and quantities.

## Start the existing local backend

Run from the repository root. Keep the phone and Mac on the same trusted LAN; USB pairing alone does not provide backend networking. Current Mac en0 IP is `172.20.10.3`; recheck after changing Wi-Fi/hotspot:

```bash
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
export DOCKER_HOST=unix://$HOME/.colima/default/docker.sock
ipconfig getifaddr en0
npm run db:start
npx supabase status
```

Do **not** reset the database. Keep status output private: it includes server secrets. If Colima is stopped, start the existing Colima runtime first. Check the reported API port (currently 54321).

If absent, copy `apps/admin/.env.example` to `.env.local`; preserve existing secrets. Set:

- `NEXT_PUBLIC_SUPABASE_URL=http://172.20.10.3:54321`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` = local publishable key (legacy local anon key if applicable)
- `SUPABASE_URL=http://172.20.10.3:54321` so server-issued Storage URLs are phone-reachable; verify actual returned upload/download URL hosts.
- `SUPABASE_SERVICE_ROLE_KEY` = local server key, server file only
- `APP_ORIGIN=http://localhost:3000`; perform admin work in Mac browser at this origin.

```bash
npm run dev:admin -- --hostname 0.0.0.0 --port 3000
```

In another terminal:

```bash
curl -i http://172.20.10.3:3000/api/v1/health
curl -i http://172.20.10.3:54321/auth/v1/health
```

On iPhone Safari open the same API health URL. A health response proves routing only, not database/auth/queue health. Allow the Mac firewall's local connection prompt if shown. Do not expose these ports through router forwarding or a public tunnel. Check port 54321 from the phone too; sign-in exercises Auth with the public key.

Use the existing admin's Members screen to invite an employee for the approved store; local invite email is in Mailpit `http://127.0.0.1:54324`. If no admin exists, use the documented bootstrap command in the operations runbook. Until actual store/POG approval, use a clearly named synthetic fixture for device mechanics only. Do not publish guessed actual-store quantities.

## Install and run on the connected iPhone

Observed paired device: **La boo boo**, UDID `00008140-000475890A47801C`, hardware identifier `iPhone17,1`. OS, developer-mode readiness and signing team have not been verified.

```bash
cd apps/ios
# Only if missing; do not overwrite existing local configuration:
cp -n DisplayRefill/Config/Local.example.xcconfig DisplayRefill/Config/Local.xcconfig
xcodegen generate
open DisplayRefill.xcodeproj
```

Set the ignored `Local.xcconfig` (replace IP if changed):

```text
API_BASE_URL = http:/$()/172.20.10.3:3000
SUPABASE_URL = http:/$()/172.20.10.3:54321
SUPABASE_PUBLISHABLE_KEY = <local publishable key>
```

1. Unlock/trust the iPhone. Enable Settings → Privacy & Security → Developer Mode if Xcode requires it; restart and confirm on the phone.
2. Xcode → Settings → Accounts: choose your Apple account. Target DisplayRefill → Signing & Capabilities: automatically manage signing, select your team; use a unique bundle identifier if the default is unavailable. Do not enable distribution/TestFlight.
3. The existing Info.plist has no local HTTP/privacy declarations. For this local Debug run, make a private temporary copy of `DisplayRefill/Resources/Info.plist` (e.g. `/tmp/DisplayRefill-LocalDebug.plist`). In Xcode's plist editor add `NSLocalNetworkUsageDescription` = “Connect to the local Display Refill test backend.” Add dictionary `NSAppTransportSecurity` with Boolean `NSAllowsArbitraryLoads` = YES. Set target Build Settings → Info.plist File **Debug only** to that absolute path. Leave Release unchanged. This temporary broad HTTP allowance is for local testing only; do not distribute it. If regenerated, reapply the generated-project Debug override.
4. Select scheme DisplayRefill and destination La boo boo. Press Run (⌘R). Approve local-network access and developer trust prompts if shown. If the app says not configured, check the three public keys and rebuild. Never bundle service/database/vision credentials.
5. Sign in as the assigned employee; verify the expected store/display. Capture the Xcode build result, phone OS and build version in `checks.csv`. A successful install alone is not workflow acceptance.

## Complete the checklist, recording evidence

Keep the worker stopped initially. Do not start cleanup: retention values are still proposals. For mock polling/review only, populate the ignored worker `.env` from its example with local server/database credentials, `VISION_PROVIDER=mock`, `VISION_MOCK_SCENARIO=review`, `WORKER_CONCURRENCY=1`, and empty vision API key/model. Then run `npm run dev:worker` from repo root. No real adapter exists. Output must be labeled synthetic; it cannot prove counting accuracy.

- [ ] Manual: assigned store/display; blanks unknown; explicit zero; count sellable containers including hidden stock; save; compare server refill to approved targets/triggers; unknown prevents confirmation; confirm; mark completion; counts/score unchanged. With worker stopped, repeat a new manual check.
- [ ] Camera: allow permission; portrait and landscape capture, retake/crop; deny camera in Settings and verify guidance/import/manual options. Import HEIC/rotated image; verify upright canonical JPEG and stripped metadata on local backend. Do not transfer photos to an external provider.
- [ ] Network: interrupt upload, background/resume, retry; verify one scan/object/job and honest saved state. Kill/relaunch and reopen saved check/history; unsaved drafts are not promised durable. Check reauthentication.
- [ ] Queue/review: worker stopped → queued and delay notice → manual takeover. Resume mock worker; late results must not replace human edits. New mock scan: accept unchanged uncertain estimate, correct another, save; original AI and correction ledger preserved. Resolve every unknown/hidden total physically before confirm.
- [ ] History/security: reopen confirmed record; completion is attestation; logout/relaunch clears session. Revoke employee and verify new API/image access denied. Existing signed links may survive until expiry.
- [ ] Accessibility: largest text, light/dark, keyboard and both orientations; human VoiceOver operation with spoken phrases/focus order recorded. Follow the full scripts in `device-accessibility.md`, including conflicts, retained/deleted photos and POG v1/v2 preservation after approved publication.

For each item record expected/observed result, pass/fail, tester/date, app build, schema, phone/OS, scan IDs and local artifact path in `checks.csv`; use pending when not exercised. Avoid storing credentials or sensitive photos in git. Real-photo capture/storage permission and dataset/backup deletion policy must be settled before collecting the actual store dataset. No real device/photo results have been recorded in this session. All release gates, A06, and Feature 13 remain incomplete.

## Latest executed session

See [2026-10-03 physical-device evidence](device-session-2026-10-03.md). Signed build/install/launch and one focused synthetic manual test passed on La boo boo. Two initial probe failures are recorded separately; the runner diagnostic LAN path remains blocked. This does not complete camera, spoken accessibility or real-store acceptance. Manual/local mock is the current owner-selected scope; no paid vision or hosted deployment authorized.
