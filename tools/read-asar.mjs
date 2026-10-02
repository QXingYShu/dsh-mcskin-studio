#!/usr/bin/env node
/* read-asar.mjs — 读取 Electron app.asar 内某个文件的文本（最小实现）
 * 用法: node tools/read-asar.mjs <app.asar 路径> <包内相对路径>
 * 例:   node tools/read-asar.mjs "...\resources\app.asar" "node_modules/@deepseek-ai/dsh-cmdline/lib/index.js"
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, normalize } from 'node:path';

const [, , asarPath, innerPath] = process.argv;
if (!asarPath || !innerPath) { console.error('用法: node tools/read-asar.mjs <app.asar> <inner/path>'); process.exit(2); }
if (!existsSync(asarPath)) { console.error('asar 不存在: ' + asarPath); process.exit(2); }

const buf = readFileSync(asarPath);
// asar header: uint32 = 4, then a Pickle: uint32 headerSize, uint32 jsonSize, then json
const size = buf.readUInt32LE(12);
const headerJson = buf.toString('utf8', 16, 16 + size);
const header = JSON.parse(headerJson);

function find(node, parts) {
  for (const p of parts) {
    if (!node || !node.files) return null;
    node = node.files[p];
    if (!node) return null;
  }
  return node;
}
function readEntry(entry) {
  if (entry.files) return null;            // directory
  const off = Number(entry.offset);
  const data = buf.subarray(16 + size + off, 16 + size + off + entry.size);
  return data;
}

const parts = normalize(innerPath).split(/[\\/]/).filter(Boolean);
const entry = find(header, parts);
if (!entry) { console.error('asar 内找不到: ' + innerPath); process.exit(3); }
if (entry.files) {
  // 目录：列出文件
  const walk = (n, prefix) => {
    for (const [name, child] of Object.entries(n.files || {})) {
      const p = prefix ? prefix + '/' + name : name;
      if (child.files) walk(child, p); else console.log(p);
    }
  };
  walk(entry, '');
} else {
  process.stdout.write(readEntry(entry));
}
