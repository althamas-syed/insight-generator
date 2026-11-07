# Project roadmap

This roadmap describes planned work, not implemented features.

## Priority 1: reliability

- Add automated tests for duplicate detection, missing values, parsing, and financial negative-value edge cases.
- Add user-controlled cleaning settings and a preview of every proposed change.
- Avoid silently imputing missing values or discarding valid negative balances and returns.
- Improve error handling for empty, malformed, and large CSV files.

## Priority 2: reusable developer tooling

- Extract the statistics and cleaning logic into a documented standalone JavaScript package.
- Provide a small public API and examples that can be imported into other apps.
- Publish versioned releases with changelogs and a stable interface.

## Priority 3: community

- Add contribution-friendly issues and a code of conduct.
- Gather genuine feedback from users and maintainers.
- Track adoption using authentic issues, contributions, package downloads, and downstream integrations.

No usage or adoption metrics are claimed until independently observed.
