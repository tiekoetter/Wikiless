import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';

const [beforePath, afterPath, reportPath] = process.argv.slice(2);

if (!beforePath || !afterPath || !reportPath) {
  throw new Error('Usage: render-npm-audit-report.mjs <before.json> <after.json> <report.md>');
}

function readAudit(path, label) {
  let audit;

  try {
    audit = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`Could not parse the ${label} npm audit response: ${error.message}`);
  }

  if (!audit.metadata?.vulnerabilities || !audit.vulnerabilities) {
    const detail = audit.error?.summary || audit.error?.code || 'unexpected response shape';
    throw new Error(`Could not read the ${label} npm audit response: ${detail}`);
  }

  return audit;
}

function total(audit) {
  return Number(audit.metadata.vulnerabilities.total ?? Object.keys(audit.vulnerabilities).length);
}

function escapeCell(value) {
  return String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
}

function fixDescription(fixAvailable) {
  if (fixAvailable === true) return 'Available';
  if (!fixAvailable) return 'Not available';

  const update = [fixAvailable.name, fixAvailable.version].filter(Boolean).join('@');
  return fixAvailable.isSemVerMajor ? `${update} (breaking update)` : update;
}

function advisoryDescription(vulnerability) {
  const advisories = vulnerability.via.filter((item) => typeof item === 'object');

  if (advisories.length === 0) {
    return vulnerability.via.join(', ') || 'See the dependency path';
  }

  return advisories
    .map((advisory) => advisory.url ? `[${advisory.title}](${advisory.url})` : advisory.title)
    .join('<br>');
}

function findingsTable(audit) {
  const severityOrder = new Map([
    ['critical', 0],
    ['high', 1],
    ['moderate', 2],
    ['low', 3],
    ['info', 4],
  ]);
  const vulnerabilities = Object.values(audit.vulnerabilities).sort((left, right) => {
    const severityDifference = (severityOrder.get(left.severity) ?? 99) -
      (severityOrder.get(right.severity) ?? 99);
    return severityDifference || left.name.localeCompare(right.name);
  });

  if (vulnerabilities.length === 0) return '_None._';

  const rows = vulnerabilities.map((vulnerability) => [
    vulnerability.name,
    vulnerability.severity,
    vulnerability.isDirect ? 'Direct' : 'Transitive',
    advisoryDescription(vulnerability),
    fixDescription(vulnerability.fixAvailable),
  ].map(escapeCell).join(' | '));

  return [
    'Package | Severity | Dependency | Advisory | npm fix',
    '--- | --- | --- | --- | ---',
    ...rows,
  ].join('\n');
}

function setOutput(name, value) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (outputPath) appendFileSync(outputPath, `${name}=${value}\n`);
}

const before = readAudit(beforePath, 'initial');
const after = readAudit(afterPath, 'post-remediation');
const beforeTotal = total(before);
const afterTotal = total(after);
const auditFixOutcome = process.env.AUDIT_FIX_OUTCOME || 'unknown';
const installOutcome = process.env.INSTALL_OUTCOME || 'unknown';
const testOutcome = process.env.TEST_OUTCOME || 'unknown';
const validationFailed = installOutcome !== 'success' || testOutcome !== 'success';
const manualReview = afterTotal > 0 || auditFixOutcome !== 'success' || validationFailed;

setOutput('before_total', beforeTotal);
setOutput('after_total', afterTotal);
setOutput('manual_review', manualReview);

const reviewNotice = manualReview
  ? '> **Manual review required.** One or more findings remain, the safe fix failed, or validation did not pass.'
  : '> No findings remain and the resulting dependency tree passed validation.';

const report = `# npm audit remediation report

This file is maintained by the [npm audit remediation workflow](workflows/npm-audit-remediation.yml).

${reviewNotice}

## Result

- Vulnerable packages before remediation: **${beforeTotal}**
- Vulnerable packages after remediation: **${afterTotal}**
- Safe \`npm audit fix\` outcome: **${auditFixOutcome}**
- Clean install outcome: **${installOutcome}**
- Test outcome: **${testOutcome}**

The workflow intentionally avoids \`npm audit fix --force\`. Fixes that require a breaking dependency update must be assessed and applied by a maintainer.

## Remaining findings

${findingsTable(after)}

## Findings detected before remediation

${findingsTable(before)}
`;

writeFileSync(reportPath, report);

if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
}
