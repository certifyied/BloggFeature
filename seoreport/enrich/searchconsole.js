export async function fetchSearchConsole(siteUrl, oauthToken) {
  if (!oauthToken) return {};
  
  try {
    const res = await fetch(`https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${oauthToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        endDate: new Date().toISOString().split('T')[0],
        dimensions: ['query', 'page']
      })
    });
    if (!res.ok) return {};
    const data = await res.json();
    
    const queries = [];
    const pages = [];
    let totalClicks = 0;
    let totalImpressions = 0;
    
    (data.rows || []).forEach(row => {
      queries.push({ query: row.keys[0], page: row.keys[1], clicks: row.clicks, impressions: row.impressions, ctr: row.ctr, position: row.position });
      totalClicks += row.clicks;
      totalImpressions += row.impressions;
    });

    return {
      queries,
      pages,
      summary: { clicks: totalClicks, impressions: totalImpressions }
    };
  } catch (e) {
    return {};
  }
}
