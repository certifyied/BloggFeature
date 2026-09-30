/**
 * Scoring Template Configuration
 * Modifying these category weights directly alters the calculated overall audit score.
 */

export const DEFAULT_SCORING_TEMPLATE = {
  // Category weights (default sums to 1.0; automatically normalized if changed)
  categoryWeights: {
    technical: 0.30,
    onpage: 0.30,
    content: 0.20,
    structured_data: 0.10,
    performance: 0.10,
    local_seo: 0.00,
  },

  // Severity penalty multipliers when calculating rule-level deductions
  severityMultipliers: {
    critical: 1.0,
    high: 0.75,
    medium: 0.50,
    low: 0.25,
    info: 0.0,
  },

  // Overall Risk thresholds
  riskRatingThresholds: {
    lowRisk: 80,
    moderateRisk: 50,
  }
};

/**
 * Calculates overall weighted score based on provided category scores and active weights template.
 * @param {Object} categoryScores - Map of category name to { score: number }
 * @param {Object} [customWeights] - Optional custom category weight overrides
 * @returns {number} Overall score between 0 and 100
 */
export function calculateOverallScore(categoryScores, customWeights = {}) {
  const weights = { ...DEFAULT_SCORING_TEMPLATE.categoryWeights, ...customWeights };

  // Calculate sum of active category weights
  let totalWeight = 0;
  for (const cat of Object.keys(categoryScores)) {
    if (weights[cat] !== undefined && weights[cat] > 0) {
      totalWeight += weights[cat];
    }
  }

  // Fallback to equal weights if no valid weights set
  if (totalWeight <= 0) {
    const cats = Object.keys(categoryScores);
    if (cats.length === 0) return 0;
    const sum = cats.reduce((acc, cat) => acc + (categoryScores[cat]?.score || 0), 0);
    return Math.round(sum / cats.length);
  }

  // Calculate normalized weighted score
  let weightedSum = 0;
  for (const [cat, data] of Object.entries(categoryScores)) {
    const w = (weights[cat] !== undefined ? weights[cat] : 0) / totalWeight;
    const score = typeof data?.score === 'number' ? data.score : 100;
    weightedSum += score * w;
  }

  return Math.max(0, Math.min(100, Math.round(weightedSum)));
}
