// Real mouse/keyboard input through Electron.
const out = {};
const data = await window.pdfeTest.read('test/sample.pdf');
const tab = await app.openFile({ path: null, name: 'sample.pdf', data });
const e = tab.editor;
await sleep(1500);
const v = e.views[0];
await v.loadContentInfo();
const pr = () => v.el.getBoundingClientRect();
const at = (x, y) => ({ x: Math.round(pr().left + x * e.scale), y: Math.round(pr().top + y * e.scale) });
const mouse = (type, p, extra = {}) => ({ type, x: p.x, y: p.y, button: 'left', clickCount: 1, ...extra });
const click = (p) => [mouse('mouseMove', p), mouse('mouseDown', p), mouse('mouseUp', p), { wait: 150 }];
const typeText = (s) => [...s].flatMap((ch) => [{ type: 'char', keyCode: ch }]);
const key = (k) => [{ type: 'keyDown', keyCode: k }, { type: 'keyUp', keyCode: k }];
const count = (kind) => v.canvas.getObjects().filter((o) => o.meta?.kind === kind).length;

// 1. Draw with the pen
app.setTool('pen');
await sleep(200);
const path = [mouse('mouseMove', at(100, 300)), mouse('mouseDown', at(100, 300))];
for (let i = 1; i <= 20; i++) path.push(mouse('mouseMove', at(100 + i * 8, 300 + Math.sin(i / 2) * 20), { modifiers: ['leftButtonDown'] }));
path.push(mouse('mouseUp', at(260, 300)), { wait: 200 });
await window.pdfeTest.input(path);
out.penStrokes = count('pen');

// 2. Edit tool: click the "Prepared by" line, select all, type replacement, click away
app.setTool('edit');
await sleep(300);
const run = v.runs.find((r) => r.str.startsWith('Prepared'));
await window.pdfeTest.input([...click(at(run.x + 20, run.base - run.fs * 0.3)), { wait: 300 }]);
out.editing = !!v.canvas.getActiveObject()?.isEditing;
await window.pdfeTest.input([{ type: 'keyDown', keyCode: 'A', modifiers: ['control'] }, { type: 'keyUp', keyCode: 'A', modifiers: ['control'] }, ...typeText('Prepared by: Typed For Real'), ...key('Escape'), { wait: 300 }]);
out.editedText = v.canvas.getObjects().find((o) => o.meta?.kind === 'text')?.text;

// 3. Select tool: click into the form field and type
app.setTool('select');
await sleep(300);
const input = v.annotEl.querySelector('input[type=text], input:not([type])');
if (input) {
  input.scrollIntoView({ block: 'center' });
  await sleep(600);
  const r = input.getBoundingClientRect();
  await window.pdfeTest.input([...click({ x: Math.round(r.left + 20), y: Math.round(r.top + r.height / 2) }), ...typeText('Form value'), ...key('Tab'), { wait: 300 }]);
  out.formValue = input.value;
  out.formDirty = e.formDirty;
} else out.formValue = 'no field found';

// 4. Select text by dragging across the Times line
v.el.scrollIntoView({ block: 'start' });
await sleep(600);
const times = v.runs.find((r) => r.str.startsWith('This paragraph'));
const a = at(times.x + 2, times.base - times.fs * 0.3), b = at(times.x + times.w * 0.6, times.base - times.fs * 0.3);
const drag = [mouse('mouseMove', a), mouse('mouseDown', a)];
for (let i = 1; i <= 10; i++) drag.push(mouse('mouseMove', { x: a.x + ((b.x - a.x) * i) / 10, y: a.y }, { modifiers: ['leftButtonDown'] }));
drag.push(mouse('mouseUp', b), { wait: 300 });
await window.pdfeTest.input(drag);
out.selectedText = getSelection().toString();
out.selectionBar = !document.getElementById('selbar').hidden;
await window.pdfeTest.shot('t8-input');
expect(out, out.penStrokes === 1, 'pen stroke drawn');
expect(out, out.editedText === 'Prepared by: Typed For Real', 'typing edits text');
expect(out, out.formValue === 'Form value' && out.formDirty, 'typing fills form');
expect(out, out.selectedText.startsWith('This paragraph') && out.selectionBar, 'text selection');
return done(out);
