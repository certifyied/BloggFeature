export function emitIssues(results, url) {
  const issues = [];
  const sevOrder = { critical: 5, high: 4, medium: 3, low: 2, info: 1 };
  
  for (const res of results) {
    if (!res.passed) {
      issues.push({
        issue: `Rule failed: ${res.ruleId}`,
        evidence: res.evidence,
        severity: res.severity,
        category: res.category,
        rule_id: res.ruleId,
        source: 'rules',
        url: url
      });
    }
  }
  
  return issues.sort((a, b) => (sevOrder[b.severity] || 0) - (sevOrder[a.severity] || 0));
}