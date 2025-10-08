When dragging floatingWindow elements via the toolbar, they teleport when I start dragging.

Always down and to the left.

Their drag after that teleport is correct, but it snaps to an incorrect position when you start dragging. This should not happen.

First create a test that REPLICATES this behaviour, ideally a playwright test, and currently fails (bc bug exists).  

Then you  can have a feedback loop to help you fix it and debug it.