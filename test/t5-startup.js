const n = performance.getEntriesByType('navigation')[0];
const out = { domContentLoaded: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd), responseEnd: Math.round(n.responseEnd), resources: performance.getEntriesByType('resource').map((r) => `${r.name.split('/').pop()} ${Math.round(r.startTime)}-${Math.round(r.responseEnd)}`) };
expect(out, out.load < 10000, 'app loads under 10 s'); // generous: only real slowdowns fail
return done(out);
