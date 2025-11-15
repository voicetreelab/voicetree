First fixup electron e2e tests.

The only one that is passing right now is our smoke test.

see `npm run test:smoke`

Ensure all other test files are passing. 
1. Spawn one subagent per failing test file in `e2e-tests/electron`. Run all agents in parallel.

Next, fixup any and all failing vite tests. `npm run test`

2. run `npm run test`, spawn one subagent per category of failing test. Run all agents in parallel.

3. Review the agents work. Look for any anti-patterns such as changing prod code (SHOULD ABSOLUTELY NOT BE REQUIRED)