# npm audit remediation report

This file is maintained by the [npm audit remediation workflow](workflows/npm-audit-remediation.yml).

> **Manual review required.** One or more findings remain, the safe fix failed, or validation did not pass.

## Result

- Vulnerable packages before remediation: **19**
- Vulnerable packages after remediation: **19**
- Safe `npm audit fix` outcome: **failure**
- Clean install outcome: **success**
- Test outcome: **success**

The workflow intentionally avoids `npm audit fix --force`. Fixes that require a breaking dependency update must be assessed and applied by a maintainer.

## Remaining findings

Package | Severity | Dependency | Advisory | npm fix
--- | --- | --- | --- | ---
@jest/core | moderate | Transitive | @jest/reporters, @jest/transform, jest-config, jest-resolve-dependencies, jest-runner, jest-runtime, jest-snapshot | jest@25.1.0 (breaking update)
@jest/expect | moderate | Transitive | jest-snapshot | jest@25.1.0 (breaking update)
@jest/globals | moderate | Transitive | @jest/expect | jest@25.1.0 (breaking update)
@jest/reporters | moderate | Transitive | @jest/transform, glob | jest@25.1.0 (breaking update)
@jest/transform | moderate | Transitive | babel-plugin-istanbul | jest@25.1.0 (breaking update)
babel-jest | moderate | Transitive | @jest/transform, babel-plugin-istanbul | jest@25.1.0 (breaking update)
babel-plugin-istanbul | moderate | Transitive | test-exclude | jest@25.1.0 (breaking update)
glob | moderate | Transitive | [Glob: AbortSignal cancellation bypass allows post-timeout filesystem traversal](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4) | jest@25.1.0 (breaking update)
jest-circus | moderate | Transitive | @jest/expect, jest-runtime, jest-snapshot | jest@25.1.0 (breaking update)
jest-config | moderate | Transitive | babel-jest, deepmerge, glob, jest-circus, jest-runner | jest@25.1.0 (breaking update)
jest-resolve-dependencies | moderate | Transitive | jest-snapshot | jest@25.1.0 (breaking update)
jest-runner | moderate | Transitive | @jest/transform, jest-runtime | jest@25.1.0 (breaking update)
jest-runtime | moderate | Transitive | @jest/globals, @jest/transform, glob, jest-snapshot | jest@25.1.0 (breaking update)
jest-snapshot | moderate | Transitive | @jest/transform | jest@25.1.0 (breaking update)
minimatch | moderate | Transitive | [minimatch has potential denial of service via globparts amplification](https://github.com/advisories/GHSA-g3hv-75wg-m249) | jest@25.1.0 (breaking update)
test-exclude | moderate | Transitive | glob, minimatch | jest@25.1.0 (breaking update)
deepmerge | low | Transitive | [deepmerge mergeObject() allows prototype poisoning of returned objects](https://github.com/advisories/GHSA-gcqx-w48m-w2h4) | jest@25.1.0 (breaking update)
jest | low | Direct | @jest/core, jest-cli | jest@25.1.0 (breaking update)
jest-cli | low | Transitive | @jest/core, jest-config | jest@25.1.0 (breaking update)

## Findings detected before remediation

Package | Severity | Dependency | Advisory | npm fix
--- | --- | --- | --- | ---
@jest/core | moderate | Transitive | @jest/reporters, @jest/transform, jest-config, jest-resolve-dependencies, jest-runner, jest-runtime, jest-snapshot | jest@25.1.0 (breaking update)
@jest/expect | moderate | Transitive | jest-snapshot | jest@25.1.0 (breaking update)
@jest/globals | moderate | Transitive | @jest/expect | jest@25.1.0 (breaking update)
@jest/reporters | moderate | Transitive | @jest/transform, glob | jest@25.1.0 (breaking update)
@jest/transform | moderate | Transitive | babel-plugin-istanbul | jest@25.1.0 (breaking update)
babel-jest | moderate | Transitive | @jest/transform, babel-plugin-istanbul | jest@25.1.0 (breaking update)
babel-plugin-istanbul | moderate | Transitive | test-exclude | jest@25.1.0 (breaking update)
glob | moderate | Transitive | [Glob: AbortSignal cancellation bypass allows post-timeout filesystem traversal](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4) | jest@25.1.0 (breaking update)
jest-circus | moderate | Transitive | @jest/expect, jest-runtime, jest-snapshot | jest@25.1.0 (breaking update)
jest-config | moderate | Transitive | babel-jest, deepmerge, glob, jest-circus, jest-runner | jest@25.1.0 (breaking update)
jest-resolve-dependencies | moderate | Transitive | jest-snapshot | jest@25.1.0 (breaking update)
jest-runner | moderate | Transitive | @jest/transform, jest-runtime | jest@25.1.0 (breaking update)
jest-runtime | moderate | Transitive | @jest/globals, @jest/transform, glob, jest-snapshot | jest@25.1.0 (breaking update)
jest-snapshot | moderate | Transitive | @jest/transform | jest@25.1.0 (breaking update)
minimatch | moderate | Transitive | [minimatch has potential denial of service via globparts amplification](https://github.com/advisories/GHSA-g3hv-75wg-m249) | jest@25.1.0 (breaking update)
test-exclude | moderate | Transitive | glob, minimatch | jest@25.1.0 (breaking update)
deepmerge | low | Transitive | [deepmerge mergeObject() allows prototype poisoning of returned objects](https://github.com/advisories/GHSA-gcqx-w48m-w2h4) | jest@25.1.0 (breaking update)
jest | low | Direct | @jest/core, jest-cli | jest@25.1.0 (breaking update)
jest-cli | low | Transitive | @jest/core, jest-config | jest@25.1.0 (breaking update)
