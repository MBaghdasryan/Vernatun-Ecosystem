---
name: Vernatun product model
description: Product boundaries and authorization rule for the Vernatun property-management platform.
---

Vernatun is a property-management platform with four user-facing products: Console for platform administration and support, OS for property organizations and operations, HAYAT for building staff, and ImTun for residents.

**Why:** The product handoff describes these as products over shared data and server-enforced access, not separate systems with duplicated business records.

**How to apply:** Reuse the shared business model and preserve permissions from the active server-resolved role and scope. Switching product surfaces must not grant additional authority.

Extend the resident property listings and inquiries in place; do not create a parallel marketplace. Photos and viewing requests must not disclose unrelated documents or contacts, or publish listings automatically.

**Why:** The user explicitly required preserving the existing moderated marketplace and its building opt-in/privacy boundary.

**How to apply:** Treat new property features as extensions of the same resident records and private conversations; keep publication a separate staff-moderated decision.

HAYAT's native mobile app belongs in a separate Replit project; do not turn Vernatun's HAYAT web module into a misleading Expo package.

**Why:** The user explicitly chose HAYAT as a separate app/project, and the HAYAT source available in Vernatun is web code rather than a native Expo client.

**How to apply:** Only package HAYAT for EAS from genuine React Native/Expo sources in its own project. In this workspace, prepare the genuine ImTun Expo client.
