# Physical device session — 2026-10-03

**Pilot acceptance incomplete.** Scope: existing app, local synthetic backend only; owner chose manual/local mock. Actual Mobile #1 POG is preserved separately and remains draft/unpublished. No real photos, external vision calls or hosted deployment in this device session.

Device: La boo boo, physical iPhone 16 Pro (iPhone17,1), iOS 27.2 / 24B5089g, Developer Mode enabled, paired/unlocked. Xcode developer directory `/Applications/Xcode.app/Contents/Developer`; Debug app 0.1.0 (build 1), bundle `com.displayrefill.app`. Signing: existing Apple Development identity, team `B6FF46PK2A`; automatic provisioning succeeded. No signing blocker.

## Executed setup

- Verified source POG exists; copied it to `references/mobile-1-fruit-pog.png` and checked identical SHA-256. Inspected image locally and transcribed seven lane labels to `mobile-1-draft.md`/CSV. No targets, triggers, sizes or approved product IDs inferred.
- Queried device via `xcrun devicectl list devices` and `device info details --device 00008140-000475890A47801C`; confirmed pairing, iOS and Developer Mode. Checked existing signing identity and certificate team.
- Built with `xcodebuild -project apps/ios/DisplayRefill.xcodeproj -scheme DisplayRefill -configuration Debug -destination 'platform=iOS,id=00008140-000475890A47801C' -derivedDataPath /tmp/display-refill-device/derived -allowProvisioningUpdates DEVELOPMENT_TEAM=B6FF46PK2A CODE_SIGN_STYLE=Automatic … build`. Public API/Auth endpoints were `http://172.20.10.3:3000` / `http://172.20.10.3:54321`; public key came from local Supabase status without bundling server keys.
- Used private `/tmp/display-refill-device/Info.plist` with local-network purpose and local HTTP allowance for the test build only; source Info.plist and Release configuration remain unchanged after restoring the generated project. This build is not for distribution.
- Installed with `xcrun devicectl device install app --device 00008140-000475890A47801C /tmp/display-refill-device/derived/Build/Products/Debug-iphoneos/DisplayRefill.app`, then launched `com.displayrefill.app`. Both succeeded.
- Adapted the existing simulator harness temporarily for physical destination, LAN API/proxy ports 3100/3101, automatic signing, and a focused manual XCUITest. Synthetic fixture retained original labels **Simulator Store / Simulator Display / Synthetic Garden Salad** even though this test ran on the physical phone. Two slots: A1 target 3/trigger 1 and A2 target 4/explicit null trigger. These are test quantities, not the real POG. Worker built but not started; manual path needs no vision calls. Existing API on 3000 left untouched.

## Initial failures and connectivity distinction

Run 1 (`manual.xcresult`) exit 65: sign-in/store/display/manual screen succeeded; test expected blank TextField `value == "Unknown"`, but device returns nil value with `placeholderValue == "Unknown"`. Run 2 screenshot/accessibility tree verified the visible placeholder. This was a probe assumption, not evidence of blank counts becoming zero; spoken VoiceOver semantics still unverified.

Run 2 (`manual-retry.xcresult`) exit 65: device app reached manual screen again; **test runner's** URLSession diagnostic call to local controller failed `NSURLErrorDomain -1009`, `Local network prohibited`. This does not describe the app's API connectivity: genuine app sign-in and manual scan creation already succeeded. Changed probe to use placeholderValue, kept disabled-confirm/stepper assertions, and moved server evidence collection to Mac-side service client. The direct runner-to-LAN diagnostic path remains unvalidated; no device permission settings were globally changed.

## Focused physical manual result

Final run `manual-final.xcresult`: **1 test passed**, exit 0, about 69.5 seconds (2026-10-03 23:10 PDT). Genuine physical UI verified sign-in and assigned store/display; blank Unknown placeholders with disabled Increase/Confirm; explicit counts 0 and 2; server refill total 5; confirmation; completion attestation; authenticated app relaunch; sign-out followed by relaunch showing sign-in.

Mac-side [server result](evidence/2026-10-03/synthetic-server-result.json) records manual scan `725770f2-d574-48d9-8980-2caa0ade67b5`, completed revision 4, A1 accepted/final 0/refill 3, A2 accepted/final 2/refill 2, total refill 5, AI quantities null, and two verified manual-count corrections. This is a small synthetic smoke pass, not the complete acceptance scenario. No camera/mock-photo workflow or human physical counting was exercised.

Curated local evidence: [blank counts](evidence/2026-10-03/physical-blank-counts.png), [refill](evidence/2026-10-03/physical-local-manual-refill.png), [confirmed](evidence/2026-10-03/physical-local-confirmed.png), [completed](evidence/2026-10-03/physical-local-completed.png), [blank accessibility tree](evidence/2026-10-03/physical-blank-accessibility-tree.txt). Synthetic fixture identities were revoked; no employee access remains from this harness. Local test servers/proxy stopped and temporary Swift probe removed. Generated Xcode project regenerated to remove temporary plist overrides.

Standalone Debug app was rebuilt and reinstalled with ordinary API endpoint `http://172.20.10.3:3000` after stopping the temporary harness proxy; successful launch leaves the app at sign-in after synthetic access cleanup. The owner’s existing local backend remains running on :3000.

## Evidence paths and remaining checks

Local private artifacts are under `/tmp/display-refill-device/`: `build.log`, `test.log`, `test-retry.log`, `test-final.log`, three xcresult bundles and exported attachments. Do not share raw diagnostics/video: they may contain device/account information. Curated synthetic artifacts are recorded separately when available. Temporary test identities/memberships revoked by harness cleanup; private test fixture removed, original Swift test source restored. Synthetic DB records remain local for audit; no reset performed.

Physical camera capture/permission allowed-denied, Photos HEIC/orientation, upload interruption/background, photo polling/mock review/manual takeover, history navigation, spoken VoiceOver, controlled largest-text/light-dark tests, employee unaided use, v1/v2 preservation and security release scenario remain pending. Existing large text/AssistiveTouch appearance on phone is not a controlled Dynamic Type or accessibility pass. A preserved merchandising image is not a real scan/ground-truth benchmark. Feature 13 and pilot acceptance remain incomplete.

## Owner manual-testing login provisioned

Owner requested a persistent temporary employee login after device installation. Rechecked installed bundle/version and the exact last-installed build artifact: API `http://172.20.10.3:3000`, Supabase Auth `http://172.20.10.3:54321`. Local Supabase status API/DB addresses verified loopback before any writes. Created dedicated employee `pilot-manual-20261003-53368c@example.com` (user ID `f2413417-db8b-4cd7-bfa1-5353c1450324`) with organization member and employee access only to synthetic Simulator Store (#SIM), Simulator Display, Simulator POG v1. Password provided directly to owner; not recorded in repository. Restricted local credential note is `/tmp/display-refill-device/manual-employee-login.json` (mode 0600).

Verified password sign-in and actual installed-build API `/me`, `/stores`, `/stores/{id}/displays` return 200 and only the assigned synthetic store/display. Verification session signed out; account/memberships kept active, no ban or automatic cleanup applied. Account survives app restart/logout and ordinary backend restart while database volumes are preserved. Local database reset/reseed or destructive volume removal deletes it (not part of seed); normal app restart does not. No automatic account expiry scheduled; revoke after owner completes testing. LAN IP/backend must remain reachable; IP change needs updated public configuration and rebuild. No hosted writes or service/API keys disclosed. Pilot acceptance unchanged.
