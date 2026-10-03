# DisplayRefill (iOS)

SwiftUI employee app. Minimum deployment target **iOS 17.0** (provisional:
not yet checked against actual store devices).

```text
project.yml                     XcodeGen spec for the app target (project file is generated, git-ignored)
DisplayRefill/App/              @main entry point only
DisplayRefill/Resources/        Info.plist (camera purpose string, public config keys)
DisplayRefill/Config/           Shared.xcconfig + Local.example.xcconfig
DisplayRefillKit/               Swift package: DisplayRefillCore (config, API client, wire models)
                                and DisplayRefillUI (SwiftUI shell); tests in Tests/
scripts/swiftc-check.sh         Fallback compile + test without Xcode/SwiftPM
```

## Configuration

Only public values ship in the app: `API_BASE_URL`, `SUPABASE_URL`,
`SUPABASE_PUBLISHABLE_KEY`. Copy `DisplayRefill/Config/Local.example.xcconfig`
to `Local.xcconfig` (git-ignored). In xcconfig, write URLs as
`http:/$()/host` because `//` starts a comment. On a physical device use the
Mac's LAN address, not `localhost`.

At launch `AppConfiguration` validates these keys and shows a
"not configured" screen naming missing keys. It refuses a secret or
service-role key in the publishable slot and refuses any bundled
`SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL` or `VISION_API_KEY`.

## Authentication (feature 03)

`DisplayRefillCore` signs in with Supabase Auth email/password through
`SupabaseAuthClient` (Supabase Auth's HTTP endpoints, behind the
`SupabaseAuthAPI` protocol; decision D31 explains why not supabase-swift yet).
`SessionManager` keeps the session in the Keychain
(`kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`), refreshes 60 s before
expiry with a single in-flight refresh, and on a 401 refreshes once and
retries once. A rejected refresh deletes the Keychain item and returns to
sign-in; a network failure keeps the session. `URLSessionAccountAPI` sends
`Authorization: Bearer` to `/api/v1/me`. Sign-out clears the Keychain item,
HTTP caches and the app's image folders, then revokes the session.
"Forgot password?" calls `POST /api/v1/auth/password-reset`; the email opens a
web page to choose the password. There is no sign-up.

Live check against a local stack (macOS, not iOS): start the admin app on
:3100 against local Supabase, create a user with one store membership, then run
the compiled test binary with `DISPLAY_REFILL_LIVE=1 LIVE_API_BASE_URL=…
LIVE_SUPABASE_URL=… LIVE_PUBLISHABLE_KEY=… LIVE_EMAIL=… LIVE_PASSWORD=…
LIVE_EXPECTED_STORE_IDS=…`. `DISPLAY_REFILL_KEYCHAIN_TEST=1` enables a real
Keychain round trip (writes to the login keychain and deletes the item).

## Build and test (with Xcode)

```bash
brew install xcodegen
cd apps/ios
xcodegen generate
xcodebuild -scheme DisplayRefill -destination 'platform=iOS Simulator,name=iPhone 16' build test
# package only:
cd DisplayRefillKit && swift build && swift test
```

**Not verified yet:** Xcode was not installed on the feature 01 machine, so
the iOS build, the generated project, simulator runs and on-device runs have
not happened.

## Fallback check (no Xcode)

```bash
apps/ios/scripts/swiftc-check.sh
```

This compiles Core, UI and the app entry point for **macOS** with plain
`swiftc` (`-warnings-as-errors`) and runs the swift-testing suite. It proves
the sources compile and Core tests pass. It does not prove the iOS build.

The feature 01 machine's Command Line Tools install was damaged: SwiftPM
could not link manifests, a stale `usr/include/swift/module.modulemap`
duplicated `bridging.modulemap`, and `_Testing_Foundation` had no module. The
check passed there with a VFS overlay that blanks the stale module map,
passed through `SWIFTC_FLAGS`:

```bash
SWIFTC_FLAGS="-vfsoverlay overlay.yaml -Xcc -ivfsoverlay -Xcc overlay.yaml -Xfrontend -disable-cross-import-overlays" \
  apps/ios/scripts/swiftc-check.sh
```

where `overlay.yaml` maps
`/Library/Developer/CommandLineTools/usr/include/swift/module.modulemap` to
an empty file. Reinstalling the Command Line Tools, or installing Xcode, should
make these flags unnecessary.

## Manual workflow (Feature 07)

After sign-in, choose an assigned store and active display with a published
POG, then start a manual check. Counts begin blank (unknown). Enter 0–999
directly; Increase/Decrease are available after an explicit value. Save to
review server recommendations grouped by product with expandable slot details,
then confirm the saved counts and refill list. Confirmed counts are immutable.
“Mark refill completed” records an employee attestation, preserving counts.

Transient failures keep entries and exact pending request/key in memory.
Retry the pending request before editing. On a revision conflict, “Reload
latest and retain my entries” shows the latest revision and keeps physical
count entries for explicit review/save. Entries are not synchronized offline.
“Saved checks” keeps only account-scoped scan-ID links in UserDefaults; opening
one re-fetches authorized server detail. This is not the Feature 11 history UI.

For a live **macOS Swift client** pass against local synthetic fixtures, first
compile the fallback binary to a known output directory, then run from repo root:

```bash
OUT_DIR=/tmp/feature07-swift apps/ios/scripts/swiftc-check.sh
DOCKER_HOST=unix://$HOME/.colima/default/docker.sock   node scripts/run-ios-manual-tests.mjs /tmp/feature07-swift/CoreTests
```

Use the documented VFS overlay flags if CLT still needs them. The script refuses
non-loopback Supabase, builds/starts the API, creates an isolated synthetic
employee/store/layout, exercises the actual Swift client and then revokes that
identity. Retained synthetic scan fixtures are cleared by local DB reset.
`--no-build` reuses the existing admin build.

This pass verifies the wire flow and a fresh session-manager/client/model reopen.
It does **not** prove the iOS target builds, actual application relaunch restores
navigation, or VoiceOver/Dynamic Type work on iPhone. Those checks remain required.
