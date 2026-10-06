# npm audit remediation report

This file is maintained by the [npm audit remediation workflow](workflows/npm-audit-remediation.yml).

> No findings remain and the resulting dependency tree passed validation.

## Result

- Vulnerable packages before remediation: **2**
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
proxy-addr | critical | Transitive | [proxy-addr vulnerable to IP spoofing via IPv4-mapped IPv6 trust subnet](https://github.com/advisories/GHSA-jqcg-44mw-7w3h) | Available
http-cache-semantics | high | Transitive | [http-cache-semantics max-stale handling can disclose cross-user cached responses](https://github.com/advisories/GHSA-ch52-4w7c-c8xp) | Available
