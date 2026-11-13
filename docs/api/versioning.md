# API Versioning

- Initial version prefix is `/api/v1` (`API_V1_PREFIX` in `@safezone/contracts`).
- Breaking changes will introduce `/api/v2` while keeping `/api/v1` supported during migration windows.
- Client applications should consume endpoints through `@safezone/api-client`, which prepends `API_V1_PREFIX` automatically.

