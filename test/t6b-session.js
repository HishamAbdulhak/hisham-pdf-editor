// Part B: after restart, tabs come back and unsaved edits are restored.
await sleep(2500);
const out = {
  tabs: app.tabs.list.map((t) => `${t.editor.fileName} dirty=${t.editor.dirty} objects=${t.editor.models.reduce((n, m) => n + (m.json?.length || 0), 0)}`),
  toast: [...document.querySelectorAll('.toast')].map((x) => x.textContent),
};
expect(out, out.tabs.some((s) => /^session-sample\.pdf dirty=true objects=[1-9]/.test(s)), 'unsaved edit restored');
return done(out);
