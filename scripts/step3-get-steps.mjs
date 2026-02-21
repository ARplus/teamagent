const token = 'ta_ca76a74dbeef38c40f33c07e64b9b03ee85021fb64f3108edc4a6aae301475be';
const BASE = 'http://localhost:3000';

const res = await fetch(`${BASE}/api/agent/my-steps`, {
  headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
});
const data = await res.json();
console.log(JSON.stringify(data, null, 2));
