import { readFileSync, writeFileSync } from 'fs';

// Strip BOM if present
let raw = readFileSync('C:\\Users\\HUAWEI\\clawd\\teamagent\\scripts\\quill-docs.json');
if (raw[0] === 0xEF && raw[1] === 0xBB && raw[2] === 0xBF) {
  raw = raw.slice(3);
}
const data = JSON.parse(raw.toString('utf8'));

const step2 = data.step2?.content || data.step2?.result || '';
const step3 = data.step3?.content || data.step3?.result || '';
const s2sum = data.step2?.summary || '';
const s3sum = data.step3?.summary || '';

writeFileSync('C:\\Users\\HUAWEI\\clawd\\teamagent\\scripts\\step2-doc.md', step2, 'utf8');
writeFileSync('C:\\Users\\HUAWEI\\clawd\\teamagent\\scripts\\step3-doc.md', step3, 'utf8');

console.log('Step2 summary:', s2sum);
console.log('Step2 length:', step2.length);
console.log('Step3 summary:', s3sum);
console.log('Step3 length:', step3.length);
console.log('Keys in data:', Object.keys(data));
