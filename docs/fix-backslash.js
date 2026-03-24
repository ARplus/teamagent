const fs = require('fs');
let c = fs.readFileSync('docs/generate-manual.js', 'utf8');

// The sed command left literal backslashes: \"AI" → "AI", etc.
// Replace all occurrences of backslash followed by AI, 人类, 协作 in quotes
c = c.replace(/"\\AI"/g, '"AI"');
c = c.replace(/"\\人类"/g, '"人类"');
c = c.replace(/"\\协作"/g, '"协作"');

fs.writeFileSync('docs/generate-manual.js', c);
console.log('Done. Remaining backslash patterns:');
const remaining = c.match(/"\\[A人协]/g);
console.log(remaining ? remaining.length : 0);
