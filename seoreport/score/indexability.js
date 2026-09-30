export function getIndexability(httpStatus, robotsBlocked, metaRobots, xRobotsTag, canonical, pageUrl, contentType) {
  const reasons = [];
  
  if (httpStatus >= 400) reasons.push(`HTTP error: ${httpStatus}`);
  if (httpStatus >= 300 && httpStatus < 400) reasons.push('Redirect with no destination');
  if (robotsBlocked) reasons.push('Blocked by robots.txt');
  if (metaRobots && metaRobots.toLowerCase().includes('noindex')) reasons.push('Meta robots: noindex');
  if (xRobotsTag && xRobotsTag.toLowerCase().includes('noindex')) reasons.push('X-Robots-Tag: noindex');
  if (canonical && canonical !== pageUrl && canonical.trim() !== '') reasons.push(`Canonical points to different URL: ${canonical}`);
  if (contentType && !contentType.includes('text/html')) reasons.push('Non-HTML content type');
  
  return {
    indexable: reasons.length === 0,
    reasons
  };
}