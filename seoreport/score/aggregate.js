export function aggregateScores(results, categoryWeights) {
  const categories = {};
  let totalScore = 0;
  let totalWeight = 0;
  
  for (const res of results) {
    if (!categories[res.category]) categories[res.category] = { score: 0, rules: [], weight: 0 };
    categories[res.category].rules.push(res);
    categories[res.category].score += res.score * res.weight;
    categories[res.category].weight += res.weight;
  }
  
  for (const cat in categories) {
    if (categories[cat].weight > 0) {
      categories[cat].score = categories[cat].score / categories[cat].weight;
    }
    const cw = categoryWeights[cat] || 10;
    totalScore += categories[cat].score * cw;
    totalWeight += cw;
  }
  
  return {
    categories,
    overall: totalWeight > 0 ? totalScore / totalWeight : 0
  };
}