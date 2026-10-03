#!/usr/bin/env bash
# Fallback Swift check for machines without Xcode where SwiftPM cannot run.
# Compiles DisplayRefillCore, DisplayRefillUI and the app entry point for
# macOS with plain swiftc, then builds and runs the swift-testing suite.
# This proves the Swift sources compile and the Core tests pass; it does NOT
# prove the iOS build. Use xcodebuild for that (see apps/ios/README.md).
#
# Extra compiler flags (for example a VFS overlay working around a broken
# Command Line Tools install) can be passed through SWIFTC_FLAGS.
set -euo pipefail

here="$(cd "$(dirname "$0")/.." && pwd)"
kit="$here/DisplayRefillKit"
out="${OUT_DIR:-$(mktemp -d)}"
mkdir -p "$out"
cd "$out"

common=(-swift-version 6 -target arm64-apple-macosx14.0 -warnings-as-errors)
if [[ -n "${SWIFTC_FLAGS:-}" ]]; then
  read -r -a extra <<< "$SWIFTC_FLAGS"
  common+=("${extra[@]}")
fi
dev="$(xcode-select -p)"
testing_fw="$dev/Library/Developer/Frameworks"
[[ -d "$testing_fw" ]] || testing_fw="$dev/Platforms/MacOSX.platform/Developer/Library/Frameworks"
testing_plugins=()
for dir in "$dev/usr/lib/swift/host/plugins/testing" "$dev/Toolchains/XcodeDefault.xctoolchain/usr/lib/swift/host/plugins/testing"; do
  [[ -d "$dir" ]] && testing_plugins=(-plugin-path "$dir")
done

echo "==> DisplayRefillCore"
swiftc "${common[@]}" -parse-as-library -enable-testing -emit-module -emit-library \
  -module-name DisplayRefillCore -emit-module-path DisplayRefillCore.swiftmodule \
  -o libDisplayRefillCore.dylib "$kit"/Sources/DisplayRefillCore/*.swift

echo "==> DisplayRefillUI"
swiftc "${common[@]}" -parse-as-library -I . -L . -lDisplayRefillCore -emit-module -emit-library \
  -module-name DisplayRefillUI -emit-module-path DisplayRefillUI.swiftmodule \
  -o libDisplayRefillUI.dylib "$kit"/Sources/DisplayRefillUI/*.swift

echo "==> App entry point"
swiftc "${common[@]}" -parse-as-library -I . -L . -lDisplayRefillCore -lDisplayRefillUI \
  -o DisplayRefillApp "$here"/DisplayRefill/App/DisplayRefillApp.swift

echo "==> DisplayRefillCoreTests"
cat > TestMain.swift <<'SWIFT'
import Testing
@main struct Runner {
  static func main() async { await Testing.__swiftPMEntryPoint() as Never }
}
SWIFT
swiftc "${common[@]}" "${testing_plugins[@]}" -parse-as-library -I . -L . -lDisplayRefillCore -F "$testing_fw" \
  -Xlinker -rpath -Xlinker "$testing_fw" -Xlinker -rpath -Xlinker "$out" \
  -module-name DisplayRefillCoreTests -o CoreTests \
  "$kit"/Tests/DisplayRefillCoreTests/*.swift TestMain.swift
DYLD_LIBRARY_PATH="$out" ./CoreTests
