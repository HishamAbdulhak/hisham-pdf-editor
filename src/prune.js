// pdf-lib keeps every object it ever loaded, so a deleted or redacted page's text
// would still be written into the file. This drops everything the document no longer uses.
import { PDFRef, PDFDict, PDFArray, PDFStream } from '@cantoo/pdf-lib';

export function pruneUnused(doc) {
  const ctx = doc.context;
  const used = new Set();
  const stack = Object.values(ctx.trailerInfo).filter(Boolean);
  while (stack.length) {
    const o = stack.pop();
    if (o instanceof PDFRef) {
      if (used.has(o.tag)) continue;
      used.add(o.tag);
      const target = ctx.lookup(o);
      if (target) stack.push(target);
    } else if (o instanceof PDFDict) {
      for (const [, v] of o.entries()) stack.push(v);
    } else if (o instanceof PDFArray) {
      stack.push(...o.asArray());
    } else if (o instanceof PDFStream) {
      stack.push(o.dict);
    }
  }
  for (const [ref] of ctx.enumerateIndirectObjects()) if (!used.has(ref.tag)) ctx.delete(ref);
}
