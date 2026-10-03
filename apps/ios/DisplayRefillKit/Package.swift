// swift-tools-version: 6.0
import PackageDescription

// Testable code for the DisplayRefill iOS app. The app target (project.yml)
// only hosts the entry point, Info.plist and build configuration.
let package = Package(
    name: "DisplayRefillKit",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "DisplayRefillCore", targets: ["DisplayRefillCore"]),
        .library(name: "DisplayRefillUI", targets: ["DisplayRefillUI"]),
    ],
    targets: [
        .target(name: "DisplayRefillCore"),
        .target(name: "DisplayRefillUI", dependencies: ["DisplayRefillCore"]),
        .testTarget(name: "DisplayRefillCoreTests", dependencies: ["DisplayRefillCore"]),
    ]
)
