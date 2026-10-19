// Part B: after restart, tabs come back and unsaved edits are restored.
await sleep(2500);
return {
  tabs: app.tabs.list.map((t) => `${t.editor.fileName} dirty=${t.editor.dirty} objects=${t.editor.models.reduce((n, m) => n + (m.json?.length || 0), 0)}`),
  toast: [...document.querySelectorAll('.toast')].map((x) => x.textContent),
};
