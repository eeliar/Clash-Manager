# ClashManager

ClashManager is a profile-based Clash and Mihomo configuration editor with a FastAPI backend and a React frontend. It manages proxies, proxy groups, rules, revisions, subscription delivery, and device-scoped tokens from one interface.

## Highlights

- Profile-based configuration editing with revision history and publishing
- Proxy imports for VLESS, WireGuard, and Shadowsocks share links
- Saved upstream subscription sources with manual sync and fetch caching
- Visual editing for groups, rules, comments, and grouped rule blocks
- Device-scoped subscription tokens with optional expiry dates
- Optional FastAPI docs when `ENABLE_API_DOCS=true`

## Project Layout

- `backend/`: FastAPI app, models, parsers, generators, and public test suite
- `frontend/`: Vite React application
- `configs/`: generated and imported YAML snapshots
- `data/`: runtime database storage

## Quick Start

1. Copy `.env.example` to `.env` and replace all placeholder secrets.
2. Start the stack:

```bash
docker compose up --build
```

3. Open `http://localhost` and sign in with the configured admin credentials.

## Environment

Required environment variables:

- `SECRET_KEY`
- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`
- `SUBSCRIPTION_TOKEN`

Important optional variables:

- `PUBLIC_BASE_URL`: base URL used when generating subscription links
- `ENABLE_API_DOCS=true`: enables `/docs` and `/openapi.json`
- `CORS_ALLOW_ORIGINS`: comma-separated list of trusted frontend origins
- `SUBSCRIPTION_CACHE_MAX_AGE`: cache lifetime for served subscriptions

Advanced Mihomo integration remains supported through:

- `MIHOMO_EXTERNAL_CONTROLLER`
- `MIHOMO_SECRET`
- `MIHOMO_CONTROLLER_URL`
- `MIHOMO_DELAY_TEST_URL`
- `MIHOMO_DELAY_TIMEOUT_MS`

The default public deployment does not start Mihomo for you. If you want controller-backed latency checks, run Mihomo separately and point these settings at that controller.

## Core Workflow

1. Create or select a profile.
2. Add proxies manually or import them from share links and saved subscription sources.
3. Build groups and rules visually.
4. Publish a revision.
5. Create device tokens and distribute the generated subscription URLs.

## Security Notes

- All admin routes require authentication.
- API docs are disabled by default.
- CORS is restricted to the origins you configure.
- Public subscription delivery is limited to `/sub/...` and requires a valid subscription token.
- Use strong, unique values for `SECRET_KEY`, `ADMIN_PASSWORD`, `SUBSCRIPTION_TOKEN`, and any Mihomo controller secret.

## Testing

Minimal public tests are included for authentication, profile management, config generation, and subscription delivery.

Backend tests:

```bash
./.venv/bin/python -m pip install -r backend/requirements-dev.txt
./.venv/bin/python -m pytest backend/test_public_api.py backend/test_public_subscription.py -q
```

Frontend build:

```bash
npm --prefix frontend run build
```

## License

This project is released under the MIT License. See `LICENSE`.
