#!/usr/bin/env bash
# Host/macOS package tests only; this is NOT an iOS app build.
# Temporary overlays work around the mixed CLT interfaces recorded in E02/E03.
# Full Xcode uses its own toolchain without these CLT workarounds.
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
dev="$(xcode-select -p)"
if [[ "$dev" != /Library/Developer/CommandLineTools ]]; then
  exec xcrun swift test --package-path "$here/DisplayRefillKit" "$@"
fi
work="${CLT_CHECK_DIR:-$(mktemp -d)}"
mkdir -p "$work"
python3 - "$dev" "$work" <<'PY'
import json, sys
from pathlib import Path
dev, work = map(Path, sys.argv[1:])
roots = []
base = dev / 'usr/lib/swift/pm/ManifestAPI/PackageDescription.swiftmodule'
for arch in ('arm64', 'x86_64'):
    private = base / f'{arch}-apple-macos.private.swiftinterface'
    public = base / f'{arch}-apple-macos.swiftinterface'
    if private.exists() and public.exists() and 'Apple Swift version 5.10' in private.read_text() and 'Apple Swift version 6.2.3' in public.read_text():
        roots.append({'type': 'file', 'name': str(private), 'external-contents': str(public)})
empty = work / 'empty.modulemap'
empty.write_text('')
roots.append({'type': 'file', 'name': str(dev / 'usr/include/swift/module.modulemap'), 'external-contents': str(empty)})
(work / 'overlay.json').write_text(json.dumps({'version': 0, 'roots': roots}))
PY
echo 'Testing the macOS host package using a temporary CLT overlay; iOS acceptance remains separate.'
exec xcrun swift test --package-path "$here/DisplayRefillKit" --manifest-cache none \
  -Xbuild-tools-swiftc -vfsoverlay -Xbuild-tools-swiftc "$work/overlay.json" \
  -Xbuild-tools-swiftc -module-cache-path -Xbuild-tools-swiftc "$work/manifest-cache" \
  -Xswiftc -vfsoverlay -Xswiftc "$work/overlay.json" \
  -Xcc -ivfsoverlay -Xcc "$work/overlay.json" \
  -Xswiftc -Xfrontend -Xswiftc -disable-cross-import-overlays \
  -Xswiftc -F -Xswiftc "$dev/Library/Developer/Frameworks" \
  -Xswiftc -plugin-path -Xswiftc "$dev/usr/lib/swift/host/plugins/testing" \
  -Xlinker -F -Xlinker "$dev/Library/Developer/Frameworks" \
  -Xlinker -rpath -Xlinker "$dev/Library/Developer/Frameworks" "$@"
