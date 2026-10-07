# Modules and extensions — current state

The platform already evaluates organization module entitlements, subscriptions
and effective permissions. Those checks remain the source of access decisions.
Module registration alone must never grant tenant or resource access.

- **Core modules:** existing application business features and their entitlements.
- **Extensions:** future optional application capabilities; no executable package
  loader or marketplace is implemented.
- **Integrations:** external providers behind reviewed contracts; not synonymous
  with a business module.

Dependency validation, versioned extension manifests and the new Modules &
Plugins management surface remain Phase 6 work. The System navigation does not
pretend that these administrative workflows already exist.

Never allow uploaded JavaScript, shell commands or arbitrary SQL to execute as
an extension installation. Existing role templates, branding and tenant
boundaries remain unchanged.
