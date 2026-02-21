const T = 'ta_a905e14b9854d5bb86442b8d44ec63844690cdcb58bd6d343aa0c86b073b70cc';
const BASE = 'http://127.0.0.1:3000';
import { writeFileSync } from 'fs';

const [s2, s3] = await Promise.all([
  fetch(`${BASE}/api/steps/cmlw3zx39000di9qgq1neersi`, {headers: {'Authorization': `Bearer ${T}`}}).then(r=>r.json()),
  fetch(`${BASE}/api/steps/cmlw3zx3e000fi9qgvaec5eui`, {headers: {'Authorization': `Bearer ${T}`}}).then(r=>r.json()),
]);

writeFileSync('step2-doc.md', s2.result || '', 'utf8');
writeFileSync('step3-doc.md', s3.result || '', 'utf8');
console.log('Step2 result length:', s2.result?.length);
console.log('Step2 summary:', s2.summary);
console.log('Step3 result length:', s3.result?.length);
console.log('Step3 summary:', s3.summary);
