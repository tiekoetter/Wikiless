# npm production dependency audit remediation report

This file is maintained by the [npm audit remediation workflow](workflows/npm-audit-remediation.yml).

The workflow audits production dependencies with `npm audit --omit=dev`. Development-only packages are excluded because they are not installed in the runtime image.

> No findings remain and the resulting dependency tree passed validation.

## Result

- Vulnerable production packages before remediation: **0**
- Vulnerable production packages after remediation: **0**
- Safe `npm audit fix` outcome: **success**
- Clean install outcome: **success**
- Test outcome: **success**

The workflow intentionally avoids `npm audit fix --force`. Fixes that require a breaking dependency update must be assessed and applied by a maintainer.

## Remaining findings

_None._

## Findings detected before remediation

_None._
