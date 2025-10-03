poll every 5 minutes to check for changes to the git diff, and if so do a
concise code review and add to webapp/codeReview.md

how to do this:
Make a shell script that just takes 5 minutes to do nothing before it finishes with exit code 0 saying
"NOW CHECK GIT DIFF, ADD CONCISE REVIEW to codeReview.md, THEN CALL ME AGAIN WITH SHELL TOOL"

```bash
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
```

you must run it in FOREGROUND (not background) with at-least a 5min bash timeout (obviously, otherwise it will timeout before 5min)

(git-diff-timer.sh might already exist, if so just run it)