# npm audit remediation report

This file is maintained by the [npm audit remediation workflow](workflows/npm-audit-remediation.yml).

> No findings remain and the resulting dependency tree passed validation.

## Result

- Vulnerable packages before remediation: **1**
- Vulnerable packages after remediation: **0**
- Safe `npm audit fix` outcome: **success**
- Clean install outcome: **success**
- Test outcome: **success**

The workflow intentionally avoids `npm audit fix --force`. Fixes that require a breaking dependency update must be assessed and applied by a maintainer.

## Remaining findings

_None._

## Findings detected before remediation

Package | Severity | Dependency | Advisory | npm fix
--- | --- | --- | --- | ---
body-parser | high | Direct | [body-parser vulnerable to Denial of Service via trailing bytes after a compressed request body](https://github.com/advisories/GHSA-27r3-jxmh-p828) | Available
