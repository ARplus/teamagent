import { readFileSync, writeFileSync } from 'fs';

let raw = readFileSync('C:\\Users\\HUAWEI\\clawd\\teamagent\\scripts\\quill-docs.json');
if (raw[0] === 0xEF && raw[1] === 0xBB && raw[2] === 0xBF) {
  raw = raw.slice(3);
}

const str = raw.toString('utf8');

// Show positions 118-132
for (let i = 118; i < 132; i++) {
  const ch = str[i];
  const code = str.charCodeAt(i);
  console.log(`pos ${i}: U+${code.toString(16).padStart(4,'0')} (${code}) = ${JSON.stringify(ch)}`);
}
