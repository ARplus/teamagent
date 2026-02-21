import { readFileSync, writeFileSync } from 'fs';

let raw = readFileSync('C:\\Users\\HUAWEI\\clawd\\teamagent\\scripts\\quill-docs.json');
if (raw[0] === 0xEF && raw[1] === 0xBB && raw[2] === 0xBF) {
  raw = raw.slice(3);
}

let str = raw.toString('utf8');

// Fix missing closing quotes in summary fields
// The pattern is: ,"content": where the comma comes right after the summary text without a closing "
// We need to find all occurrences of ,"content": that don't have a " immediately before the comma
function fixMissingQuotes(s) {
  // Find all positions where ,"content": appears without a preceding "
  let result = s;
  let offset = 0;
  const pattern = ',"content":"';
  let idx = s.indexOf(pattern);
  while (idx >= 0) {
    // Check the character before ","content":"
    const actualIdx = idx + offset;
    const charBefore = result[actualIdx - 1];
    if (charBefore !== '"') {
      // Insert closing quote
      result = result.slice(0, actualIdx) + '"' + result.slice(actualIdx);
      offset += 1;
      console.log(`Fixed missing closing quote at position ${idx} (original)`);
    }
    idx = s.indexOf(pattern, idx + 1);
  }
  return result;
}

str = fixMissingQuotes(str);

try {
  const data = JSON.parse(str);
  console.log('JSON parsed successfully!');
  
  const step2content = data.step2?.content || '';
  const step2summary = data.step2?.summary || '';
  const step3content = data.step3?.content || '';
  const step3summary = data.step3?.summary || '';
  
  console.log('Step2 summary:', step2summary.slice(0, 150));
  console.log('Step2 content length:', step2content.length);
  console.log('Step3 summary:', step3summary.slice(0, 150));
  console.log('Step3 content length:', step3content.length);
  
  writeFileSync('C:\\Users\\HUAWEI\\clawd\\teamagent\\scripts\\step2-doc.md', step2content, 'utf8');
  writeFileSync('C:\\Users\\HUAWEI\\clawd\\teamagent\\scripts\\step3-doc.md', step3content, 'utf8');
  console.log('\nFiles written: step2-doc.md and step3-doc.md');
} catch (e) {
  console.error('Still failed:', e.message);
  const match = e.message.match(/position (\d+)/);
  if (match) {
    const pos = parseInt(match[1]);
    console.log('Error at pos:', pos);
    console.log('Context:', JSON.stringify(str.slice(pos - 10, pos + 15)));
  }
}
