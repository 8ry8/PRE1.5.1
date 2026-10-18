# Prompt Refining Engine — Android client

This is a Kotlin + Jetpack Compose Android application with the same domain contract as the SPA and Apple client.

## Beginner setup

1. Install Android Studio Ladybug or newer and Android SDK 35.
2. Open the `android/` folder in Android Studio.
3. Let Gradle sync. The first sync downloads the Android and Compose dependencies.
4. Select an emulator or connected Android device and press Run.
5. The app starts in local-first mode; no API key is included and no provider call is made.

The app includes the workbench, context attachment through the Android document picker, source-cited change review, pre-flight linter view, local history, deterministic regression evaluation, and an evidence-rule screen. `LocalWorkspaceStore` uses SharedPreferences for the first offline build; it can be replaced with encrypted Room storage without changing the domain types.

## Production boundary

The browser and mobile clients deliberately do not contain provider credentials. Add a separately authenticated server relay and provider adapters only after implementing tenant permissions, cost limits, redaction, audit logging, and a sandbox for Agentic tools.
