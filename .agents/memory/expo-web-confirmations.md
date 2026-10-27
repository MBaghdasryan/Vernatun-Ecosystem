---
name: Expo web confirmations
description: Cross-platform confirmation behavior for actions tested in Expo's web target.
---

On React Native Web, `Alert.alert` does not invoke its native button callbacks. Use a browser-native confirmation for web and retain `Alert.alert` for iOS and Android.

**Why:** Marketplace owner actions and viewing submissions appeared to succeed in the UI test without executing their confirmation callbacks on web.

**How to apply:** For Expo actions that require user confirmation, branch on the platform and verify the web path with an actual browser interaction.
