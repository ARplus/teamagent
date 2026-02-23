#!/bin/bash
cd /home/ubuntu/teamagent
# Update NEXTAUTH_URL to HTTPS
grep -q 'NEXTAUTH_URL' .env && \
  sed -i "s|NEXTAUTH_URL=.*|NEXTAUTH_URL=\"https://118.195.138.220\"|" .env || \
  echo 'NEXTAUTH_URL="https://118.195.138.220"' >> .env
echo "Updated:"
grep NEXTAUTH_URL .env
