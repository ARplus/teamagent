import { readFileSync, writeFileSync } from 'fs';

let raw = readFileSync('C:\\Users\\HUAWEI\\clawd\\teamagent\\scripts\\quill-docs.json');
if (raw[0] === 0xEF && raw[1] === 0xBB && raw[2] === 0xBF) {
  raw = raw.slice(3);
}

const str = raw.toString('utf8');

// Show all chars at positions 115-135 with code points
for (let i = 115; i < 135; i++) {
  const ch = str[i];
  const code = str.charCodeAt(i);
  console.log(`pos ${i}: U+${code.toString(16).padStart(4,'0')} = ${JSON.stringify(ch)}`);
}

// Show raw bytes in the file at those positions
// We need to find the byte offset for position 115
let byteOffset = 0;
let charPos = 0;
const encoded = Buffer.from(str, 'utf8');
// Actually just iterate
for (let i = 0; i < str.length; i++) {
  const code = str.charCodeAt(i);
  if (code > 0xFFFF) byteOffset += 4;
  else if (code > 0x7FF) byteOffset += 3;
  else if (code > 0x7F) byteOffset += 2;
  else byteOffset++;
  if (i === 120) console.log('\nByte offset at char 120:', byteOffset);
  if (i >= 120 && i <= 135) {
    // show next bytes
  }
}
