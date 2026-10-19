const n = performance.getEntriesByType('navigation')[0];
return { domContentLoaded: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd), responseEnd: Math.round(n.responseEnd), resources: performance.getEntriesByType('resource').map((r) => `${r.name.split('/').pop()} ${Math.round(r.startTime)}-${Math.round(r.responseEnd)}`) };
