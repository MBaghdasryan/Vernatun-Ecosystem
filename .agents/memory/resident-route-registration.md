---
name: Resident route registration
description: Dynamic resident sections require explicit component mounting as well as imports and registry entries.
---

For resident extensions, verify both the web and native route renderer actually
mount each new component. An import or a section-name registry is not enough.
Also check nested features such as household management inside account settings.

**Why:** During continuity work, imports survived while the render calls were
missing in both products and in a nested settings component. Typechecks and bundles
passed, but the real Services route still exposed only the old subscription form.

**How to apply:** Check the concrete JSX branches, use a targeted unused-import
diagnostic where helpful, and accept the controls on the actual signed-in route.
Do not treat API tests or successful compilation as evidence of UI integration.
Manager work uses HAYAT's separate renderer. Mount operational features there;
do not relax OS product access to compensate for mounting them in the wrong portal.

For broadcast inboxes, keep custom-message payloads on the same `title`/`body`
contract the web and native readers consume. Verify the displayed message text,
not only that a notification row exists in the API response.

**Why:** An isolated send and inbox query succeeded while the resident screen
showed only its timestamp and read status because the response exposed storage
field names instead of the reader contract.

**How to apply:** When adding a notification kind or channel, test a delivered
message through each real signed-in shell and confirm its title and body render.
