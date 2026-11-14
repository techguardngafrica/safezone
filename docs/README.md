# Safezone docs

| Folder                                                 | What lives here                                                    |
| ------------------------------------------------------ | ------------------------------------------------------------------ |
| [product/](product/)                                   | Product brief, PRD (v0.2) and implementation plan. Business rules. |
| [product/phase-0-status.md](product/phase-0-status.md) | What Phase 0 delivered and what is still open                      |
| [product/phase-1-status.md](product/phase-1-status.md) | Phase 1 progress: what is built, verified and next                 |
| [architecture/](architecture/README.md)                | App docs, module docs and ADRs. **The engineering spec.**          |
| [api/](api/README.md)                                  | API conventions, OpenAPI notes, webhooks and provider callbacks    |
| [database/](database/README.md)                        | Schema conventions, RLS, migrations, retention                     |
| [operations/](operations/README.md)                    | Runbooks, on-call, incident response, environments                 |
| [UI_GUIDELINES.md](UI_GUIDELINES.md)                   | Design guidelines, UI/UX specs, tokens, components, accessibility  |

Start with [AGENTS.md](../AGENTS.md) for how to work in this repo, then [architecture/README.md](architecture/README.md).

## Confirmed decisions

- Four primary surfaces: Resident App, Estate Management App (web + mobile), Security App, Super Admin Portal — plus Public Web.
- Free estate onboarding; all core features free; no pricing work for now.
- Self-service and Techguard-assisted onboarding are both required.
- All advertising revenue goes to Safezone/Techguard; no estate revenue share.
- No dedicated vendor app (web Vendor Portal and/or Vendor mode in the Resident App).
- Advertisers use the web and/or Advertiser mode in the Resident App.
- Push: Expo Notifications. Email: Zoho SMTP.
