#!/bin/bash
psql -U teamagent -d teamagent -c "SELECT id, name, \"userId\", \"isMainAgent\" FROM \"Agent\" WHERE name='Lobster';"
echo "---"
psql -U teamagent -d teamagent -c "SELECT id, name, email FROM \"User\" WHERE email='aurora@arplus.top';"
echo "---"
# Check what step's assignee looks like
psql -U teamagent -d teamagent -c "SELECT s.id, s.title, s.\"assigneeId\", s.status, a.\"userId\" as agent_user_id FROM \"TaskStep\" s LEFT JOIN \"Agent\" a ON a.id = s.\"assigneeId\" WHERE s.status='waiting_approval' LIMIT 5;"
