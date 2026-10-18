// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "PromptRefiningEngine",
    platforms: [
        .iOS(.v17),
        .macOS(.v14)
    ],
    products: [
        // Xcode can use this executable target for a macOS preview and can add
        // the same source files to an iOS App target without changing the domain.
        .executable(name: "PromptRefiningEngineApp", targets: ["PromptRefiningEngineApp"])
    ],
    targets: [
        .executableTarget(
            name: "PromptRefiningEngineApp",
            path: "Sources/PromptRefiningEngineApp",
            resources: [.process("Resources")]
        )
    ]
)
