THIS PROJECT AIMS TO FOLLOW FUNCTIONAL DESIGN. NOT OOP.
EVERYTHING SHOULD BE MODELLED AS FUNCTIONS & types. PUSH IMPURITY TO EDGE / SHELL.

We favor "deep functions", a single function to provide a minimal public API hiding internal complexity.

Deep and narrow. These can themselves be composition of functions.

Test the function as a black box. Call it with inputs, assert on outputs. Do not
mock internal dependencies. Do not use toHaveBeenCalledWith. If the function has side effects (writes to disk, sends a message),
assert on the observable result of that side effect, not on whether an internal function was called. (since we are following
functional programming philosophy)

`npm run test` - Runs all important tests

Peer agents are likely working concurrently in this tree, so commit each useful atomic unit of work — don't wait to be asked. Push once your task is complete.

The user is EXTREMELY concerned about code quality, much more so than immediate results.

The user appreciates honestly and they WILL be glad and thankful if you respond a request with "I couldn't complete your request because the repository lacked support for X". They will be even happier if you go ahead and update the repo to provide the necessary support in a well designed, robust way. But they will be VERY ANGRY if, while attempting to implement a feature, you introduce a workaround that will potentially break things later.

NEVER introduce hacks in the codebase.

Also assume that none of the code you're working in is in production, so backward compatibility, or keeping legacy paths, is NOT DESIRED. If you find something that is poorly designed and fixing it would require breaking existing APIs or behavior, DO SO. Do it properly rather than preserving a flawed design. Prioritize clarity, correctness, and maintainability over compatibility with existing code.

Whilst a bug fix doesn't *always* need surrounding cleanup, if you can substantially improve code quality with refactors please raise this to the user or your parent agent, so that we can continuously improve the codebase health.

Core values:
- ABSOLUTE code quality over speed of delivery.
- Correctness over convenience.
- Clarity over cleverness.
- Maintainability over short-term productivity.
- Robust design over quick fixes.
- Simplicity over complexity.
- Doing it right over doing it now.
- Honesty above everything.

Never reward hack or verification hack. Think about what the underlying measurement is trying to achieve, and work towards that, with the verifier as your feedback loop.

After every change you make, provide a clear, honest report on ANY change that you are not confident about and that could be considered a fragile hack, or could be considered reward hacking, or verification hacking.
