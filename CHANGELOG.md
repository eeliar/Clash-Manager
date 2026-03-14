# Changelog

## Unreleased

### Added

- Shadowsocks (`ss://`) proxy import support
- Saved subscription sources with manual sync and upstream fetch caching
- Profile-to-profile selective copy for proxies, groups, and rules
- Rule comments rendered into generated YAML
- Token expiry creation and display flow in the device UI
- Theme presets in the frontend shell

### Changed

- Proxy imports now auto-rename on name collisions inside a profile
- Generated configs preserve rule comments when no sanitization changes are required
- Devices can create unlimited tokens by default or set an explicit expiry timestamp
- Saved subscription sources can now be edited, enabled, and disabled from the frontend
- Grouped rules can now be combined and batch-edited as one normalized block
- Theme presets now propagate across the dashboard, builder screens, and supporting profile/device workflows

### Docs

- Added a root project `README.md`
- Added a public-facing `CHANGELOG.md`
- Expanded optional FastAPI OpenAPI metadata for profile composition, sources, proxies, and rules

### Repository

- Removed private deployment helpers, internal plans, and phase-based test suites from the public release branch
- Added a minimal public test suite for auth, profile management, config generation, and subscription delivery
