const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../src/app/page.tsx');
let c = fs.readFileSync(filePath, 'utf8');

// Add currentUserId to all TaskGroup calls that don't have it
const before = (c.match(/currentUserId=\{currentUserId\}/g) || []).length;

// Replace each TaskGroup closing without currentUserId
c = c.replace(/(dot="bg-blue-500") \/>/g, '$1 currentUserId={currentUserId} />');
c = c.replace(/(dot="bg-slate-400") \/>/g, '$1 currentUserId={currentUserId} />');
c = c.replace(/(dot="bg-green-500") \/>/g, '$1 currentUserId={currentUserId} />');

const after = (c.match(/currentUserId=\{currentUserId\}/g) || []).length;

fs.writeFileSync(filePath, c, 'utf8');
console.log(`currentUserId placements: ${before} → ${after}`);
console.log('Done!');
