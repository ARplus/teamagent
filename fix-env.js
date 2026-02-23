const fs = require('fs')
const path = '/home/ubuntu/teamagent/.env'
let c = fs.readFileSync(path, 'utf8')
c = c.replace(/NEXTAUTH_URL=.*/, 'NEXTAUTH_URL="https://118.195.138.220"')
fs.writeFileSync(path, c)
console.log('Updated NEXTAUTH_URL to HTTPS')
const updated = c.match(/NEXTAUTH_URL=.*/)[0]
console.log(updated)
