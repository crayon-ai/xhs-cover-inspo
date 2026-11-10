#!/usr/bin/env node
'use strict';

/**
 * 校验 app.js 内联的 AGENT_PROMPT 与 prompt-agent.md 逐字一致。
 * 运行时不读取 md；本脚本仅供提交前检查。
 */
var fs = require('fs');
var path = require('path');

var root = path.resolve(__dirname, '..');
var mdPath = path.join(root, 'prompt-agent.md');
var jsPath = path.join(root, 'app.js');

var md = fs.readFileSync(mdPath, 'utf8');
if (md.charCodeAt(0) === 0xfeff) md = md.slice(1);
md = md.replace(/\r\n/g, '\n');

var js = fs.readFileSync(jsPath, 'utf8');
var begin = js.indexOf('// --- BEGIN AGENT_PROMPT ---');
var end = js.indexOf('// --- END AGENT_PROMPT ---');
if (begin < 0 || end < 0 || end <= begin) {
  console.error('FAIL: AGENT_PROMPT markers not found in app.js');
  process.exit(1);
}
var block = js.slice(begin, end);
var m = block.match(/var AGENT_PROMPT\s*=\s*("(?:\\.|[^"\\])*")\s*;/);
if (!m) {
  console.error('FAIL: could not parse var AGENT_PROMPT in app.js');
  process.exit(1);
}
var inline;
try {
  inline = JSON.parse(m[1]);
} catch (e) {
  console.error('FAIL: AGENT_PROMPT is not a valid JSON string');
  process.exit(1);
}

if (inline === md) {
  console.log('OK: AGENT_PROMPT matches prompt-agent.md (' + md.length + ' chars)');
  process.exit(0);
}

var n = Math.min(inline.length, md.length);
var i = 0;
while (i < n && inline.charAt(i) === md.charAt(i)) i++;
console.error('FAIL: AGENT_PROMPT does not match prompt-agent.md');
console.error('  inline length:', inline.length, 'md length:', md.length);
console.error('  first diff at index', i);
console.error('  inline around:', JSON.stringify(inline.slice(Math.max(0, i - 20), i + 20)));
console.error('  md around:', JSON.stringify(md.slice(Math.max(0, i - 20), i + 20)));
process.exit(1);
