#!/bin/bash

# Simple 5-minute timer for git diff review reminder

echo "[$(date)] Starting 5-minute timer for git diff review..."
echo "Will notify in 5 minutes to check git diff and update codeReview.md"

# Wait for 5 minutes
sleep 300

echo "======================================"
echo "[$(date)] TIMER COMPLETE!"
echo "NOW CHECK GIT DIFF, ADD CONCISE REVIEW to codeReview.md, THEN CALL ME AGAIN WITH SHELL TOOL"
echo "======================================"

exit 0