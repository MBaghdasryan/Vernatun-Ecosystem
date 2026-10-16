# ImTun by Vernatun — Android build

## What's configured

- Expo SDK 57 / React Native 0.86.
- Android package: `com.vernatun.imtun`.
- App version: `1.0.0`; initial Android version code: `1`.
- Android target SDK: `36`, set by the Expo `expo-build-properties` config plugin.
- The generated Android manifest does not request legacy external-storage access or display-over-other-apps access; it keeps only permissions needed by the current app.
- `preview` builds an internal-distribution APK.
- `production-initial` builds the first Google Play AAB at version code 1.
- `production` builds later AABs and automatically increments the EAS remote Android version code.
- Production API host: `https://api.vernatun.io`; no API secrets are included.

## Windows PowerShell

Extract the archive and enter the project directory:

```powershell
Expand-Archive -Path .\ImTun-Expo-Ready.zip -DestinationPath .\ImTun-Expo-Ready
Set-Location .\ImTun-Expo-Ready
```

Install the pinned workspace dependencies and run local checks:

```powershell
corepack enable
corepack pnpm install --frozen-lockfile
Copy-Item .env.example .env
corepack pnpm exec expo install --check
corepack pnpm dlx expo-doctor@latest
corepack pnpm run typecheck
```

Link this independent ImTun app to the owner's Expo/EAS account. This is an interactive, owner-authorized setup; no project ID is fabricated in the archive:

```powershell
npx eas-cli@latest login
npx eas-cli@latest init
```

For the first production release, initialize EAS remote Android versioning to `1` once. When prompted, select Android and enter `1`:

```powershell
npx eas-cli@latest build:version:set --platform android --profile production-initial
```

Build an installable internal-testing APK:

```powershell
npx eas-cli@latest build --platform android --profile preview
```

Build the first Google Play AAB without incrementing the initial version code:

```powershell
npx eas-cli@latest build --platform android --profile production-initial
```

For subsequent Google Play AABs, use the `production` profile. EAS remote versioning increments the Android version code automatically:

```powershell
npx eas-cli@latest build --platform android --profile production
```

These commands are provided for the owner to run when ready. No EAS cloud build or Play Store submission is started during project preparation.

## Outstanding owner actions

- Run `eas init` while signed into the correct Expo account; commit the generated `extra.eas.projectId` so future builds link to this ImTun EAS project.
- Confirm `com.vernatun.imtun` is the intended Play Console application ID. It matches the current project config; Play Console registration was not checked.
- If this package already has a Play Store release, confirm EAS is using its existing Android signing key; do not reset or replace the key.
- Provide and approve a privacy-policy URL before Play Store submission. No approved privacy policy URL was present in the project, so none is invented or configured.
- If the app later adds native camera or gallery picking, review the new feature's minimum required Android permissions and disclosure before re-enabling any media access.
- Test login, cookie-session persistence, CSRF-protected writes, and API connectivity on an Android device with a designated test account. Browser preview CORS does not substitute for native verification.
