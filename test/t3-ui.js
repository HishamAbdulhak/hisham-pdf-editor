// UI: paragraph edit, search, text selection bar, night mode, Arabic interface, tabs/session.
const out = {};
const data = await window.pdfeTest.read('test/sample.pdf');
const tab = await app.openFile({ path: null, name: 'sample.pdf', data });
const e = tab.editor;
await sleep(1200);
const v = e.views[0];
await v.loadContentInfo();
out.paragraphs = v.paragraphs.filter((p) => p.runs.length > 1).map((p) => p.str);
// Paragraph edit via the Edit tool hit test
app.setTool('edit');
const para = v.paragraphs.find((p) => p.runs.length > 1);
const hit = v.hitTest(para.x + 5, para.runs[1].base - 3);
out.hitIsParagraph = !!hit?.para;
e.editText(v, hit, new MouseEvent('mousedown', { clientX: 1, clientY: 1 }));
const tb = v.canvas.getActiveObject();
tb.text = `${para.str} We also opened two new offices this month.`;
tb.initDimensions();
tb.exitEditing();
app.setTool('select');
out.editedLines = tb.textLines.length;
await sleep(300);
await window.pdfeTest.shot('t3-paragraph');
// Search
document.getElementById('findbar').hidden = false;
const input = document.getElementById('findInput');
input.value = 'quarter';
input.dispatchEvent(new Event('input'));
await sleep(900);
out.searchCount = document.getElementById('findCount').textContent;
await window.pdfeTest.shot('t3-search');
// Text selection -> highlight bar
const spans = [...v.textEl.querySelectorAll('span')].filter((s) => /Times Roman/.test(s.textContent));
if (spans.length) {
  const r = document.createRange();
  r.selectNodeContents(spans[0]);
  getSelection().removeAllRanges();
  getSelection().addRange(r);
  document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  await sleep(200);
  out.selbarVisible = !document.getElementById('selbar').hidden;
  await window.pdfeTest.shot('t3-selection');
  document.querySelectorAll('#selbar button')[1].click(); // Highlight
  await sleep(300);
  out.markupObjects = v.canvas.getObjects().filter((o) => o.meta?.kind === 'markup').length;
} else out.selbarVisible = 'no text spans';
// Night mode + Arabic UI
document.querySelector('#viewGroup .tb-btn:nth-child(2)').click();
await sleep(600);
document.querySelector('#moreGroup .tb-btn:nth-child(2)').click();
await sleep(600);
await window.pdfeTest.shot('t3-arabic-night');
out.dir = document.documentElement.dir;
out.saveLabel = document.querySelector('#fileGroup .tb-btn:nth-child(2) span').textContent;
return out;
