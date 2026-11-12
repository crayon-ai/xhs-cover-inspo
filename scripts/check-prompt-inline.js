#!/usr/bin/env node
'use strict';

/**
 * 文档校验：确认 prompt-agent.md 仍在仓库。
 * 运行时已改用静态图 assets/prompt-flow-poster.png，不再内联 AGENT_PROMPT。
 * 若 app.js 又出现内联标记则失败。
 */
var fs = require('fs');
var path = require('path');

var root = path.resolve(__dirname, '..');
var mdPath = path.join(root, 'prompt-agent.md');
var jsPath = path.join(root, 'app.js');

var md = fs.readFileSync(mdPath, 'utf8');
if (md.charCodeAt(0) === 0xfeff) md = md.slice(1);
md = md.replace(/\r\n/g, '\n');
console.log('OK: prompt-agent.md exists (' + md.length + ' chars)');

var js = fs.readFileSync(jsPath, 'utf8');
var begin = js.indexOf('// --- BEGIN AGENT_PROMPT ---');
var end = js.indexOf('// --- END AGENT_PROMPT ---');
if (begin < 0 || end < 0 || end <= begin) {
  console.log('runtime 不再内联 AGENT_PROMPT，跳过一致性校验');
  process.exit(0);
}
console.error('FAIL: app.js 仍内联 AGENT_PROMPT，导出已改用静态图 assets/prompt-flow-poster.png');
process.exit(1);
