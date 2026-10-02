#!/usr/bin/env node
/* tests/inspect_dom.mjs — 从 dump 出的 DOM 里提取页面状态（归属：Lead） */
import { readFileSync } from 'node:fs';

const file = process.argv[2] || 'tests/out/index.dom.html';
const d = readFileSync(file, 'utf8');

function tag(html, id) {
  const re = new RegExp('<[a-z]+[^>]*id="' + id + '"[^>]*>([\\s\\S]*?)</[a-z]+>');
  const m = re.exec(html);
  return m ? m[1].replace(/\s+/g, ' ').trim() : null;
}

console.log('title           :', (/<title>([\s\S]*?)<\/title>/.exec(d) || [, ''])[1].trim().slice(0, 120));
console.log('statusLine      :', (tag(d, 'statusLine') || '').slice(0, 200));
console.log('testReport      :', (tag(d, 'testReport') || '').slice(0, 200));
console.log('canvasBadge     :', tag(d, 'canvasBadge'));
console.log('cursorHint      :', (tag(d, 'cursorHint') || '').slice(0, 160));
console.log('footInfo        :', (tag(d, 'footInfo') || '').slice(0, 200));
console.log('glHud           :', tag(d, 'glHud'));

const glErr = tag(d, 'glError');
console.log('glError text    :', glErr ? glErr.slice(0, 300) : '(empty)');
console.log('glError hidden  :', /id="glError"[^>]*hidden/.test(d) || /hidden[^>]*id="glError"/.test(d));

const st = /<script[^>]*id="selftest-json"[^>]*>([\s\S]*?)<\/script>/.exec(d);
if (st) {
  try {
    const j = JSON.parse(st[1].replace(/&quot;/g, '"'));
    console.log('in-page selfTest: ' + j.pass + ' pass / ' + j.fail + ' fail');
    if (j.failures && j.failures.length) j.failures.slice(0, 20).forEach(f => console.log('   ✗ ' + f));
  } catch (e) { console.log('selfTest JSON 解析失败: ' + e.message); }
} else {
  console.log('in-page selfTest: (未生成 selftest-json)');
}

const probeTags = [...d.matchAll(/<script[^>]*id="probe-json"[^>]*>([\s\S]*?)<\/script>/g)];
console.log('probe-json tags :', probeTags.length);
for (const t of probeTags) {
  try {
    const j = JSON.parse(t[1].replace(/&quot;/g, '"'));
    console.log('probe: ' + j.pass + ' pass / ' + j.fail + ' fail');
    (j.failures || []).forEach(f => console.log('   ✗ ' + f));
    (j.errors || []).forEach(f => console.log('   ! ' + f));
    break;
  } catch (e) { /* 注释里的假标签 */ }
}
const guide = tag(d, 'guideBody');
if (guide) console.log('guideBody head  :', guide.slice(0, 160));
