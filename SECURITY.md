# Security policy

## Reporting a vulnerability

Please do not open a public issue for a security problem.

Report it privately through GitHub's
[Report a vulnerability](https://github.com/Isafe-nk/rapid-log/security/advisories/new)
form, which opens a draft advisory only the maintainer can see.

Include what you found, how to reproduce it, and what an attacker could reach
with it. You will get an acknowledgement within a week.

## Scope

Rapid Log has no backend of its own — the browser talks to Firestore directly,
and access control lives entirely in [`firestore.rules`](firestore.rules). The
most valuable reports are therefore ones showing that those rules let an account
read or write entries belonging to someone else.

Also in scope: anything in this repository, the deployed web app at
`to-do-rapidlog.web.app`, and the published macOS app.

Out of scope:

- **The Firebase web API key in `firebase-applet-config.json`.** It is a public
  identifier, not a secret, and is meant to ship in the client. Firestore rules
  are what protect the data.
- Missing notarization on the macOS app. Known, and documented in the README.
- Findings from automated scanners with no demonstrated impact.

## Supported versions

Only the current release is supported. Fixes ship to `main` and are deployed
from there.
