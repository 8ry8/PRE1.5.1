# Prompt Refining Engine — Apple client

This folder contains the shared SwiftUI source for the iOS and macOS client surfaces. The sandbox used to draft this repository does not contain Xcode, so the project is intentionally delivered as a Swift Package plus source files rather than as a generated `.xcodeproj` binary.

## Beginner setup

1. Install Xcode 15.4 or newer on macOS.
2. Open `apple/Package.swift` in Xcode.
3. Select the `PromptRefiningEngineApp` scheme for a macOS preview, or create an iOS App target and add the files under `Sources/PromptRefiningEngineApp`.
4. Keep the deployment target at iOS 17 / macOS 14 or newer.
5. Run the app. It starts in local-first mode; no provider API key is included.

The SwiftUI client mirrors `shared/prompt-project.schema.json`, the source-cited rule IDs, and the deterministic offline refinement engine. A production provider relay should be added later as a separate, authenticated target; API secrets must never be embedded in this client.
