# API versioning

- URL major version: `/v1`. Additive changes (new fields, routes, optional parameters) do not bump it.
- Breaking changes ship as `/v2` routes alongside `/v1` for at least 6 months.
- Apps call through `@safezone/api-client`, whose types come from the generated contract, so a breaking change fails app type checks before release.
- Forced and soft updates: `GET /v1/public/app-config?app=&platform=&version=` returns `update: hard | soft | none` from the `app_versions` table (Super Admin sets it), falling back to `APP_MIN_VERSION` / `APP_RECOMMENDED_VERSION`.
