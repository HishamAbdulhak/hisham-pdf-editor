// Part A: open two files by path, edit one, let autosave run, then "crash" (quit without saving).
// Run t6b next with KEEP=1 (see package.json "test").
await window.pdfeTest.write('session-sample.pdf', await window.pdfeTest.read('test/sample.pdf'));
const f1 = await window.desktop.readPdf('test/out/session-sample.pdf');
const tab = await app.openFile(f1);
await sleep(800);
const v = tab.editor.views[0];
await tab.editor.showView(v);
v.canvas.add(tab.editor.makeTextbox('Unsaved note from session A', { left: 80, top: 760 }));
tab.editor.commit(v);
const data2 = await window.pdfeTest.read('test/big.pdf');
await app.openFile({ path: null, name: 'big.pdf', data: data2 });
await sleep(2500); // autosave runs after 1.5 s
const out = { tabs: app.tabs.list.map((t) => `${t.editor.fileName} dirty=${t.editor.dirty}`) };
expect(out, out.tabs.includes('session-sample.pdf dirty=true'), 'edited tab is dirty');
return done(out);
