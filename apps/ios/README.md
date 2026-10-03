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
