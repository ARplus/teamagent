#!/bin/bash
cd /home/ubuntu/teamagent
sed -i 's|https://118.195.138.220|http://118.195.138.220|g' .env
grep NEXTAUTH_URL .env
pm2 restart teamagent --update-env
