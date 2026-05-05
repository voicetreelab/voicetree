THIS PROJECT AIMS TO FOLLOW FUNCTIONAL DESIGN. NOT OOP.
EVERYTHING SHOULD BE MODELLED AS FUNCTIONS & types. PREFER. PUSH IMPURITY TO EDGE / SHELL.

We favor "deep functions", a single function to provide a minimal public API hiding internal complexity.
Deep and narrow. These can themselves be composition of functions.

Test the function as a black box. Call it with inputs, assert on outputs. Do not
mock internal dependencies. Do not use toHaveBeenCalledWith. If the function has side effects (writes to disk, sends a message),
assert on the observable result of that side effect, not on whether an internal function was called. (since we are following
functional programming philosophy)

`npm run test` - Runs all important tests
