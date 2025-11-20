First fixup electron e2e playwright tests.

see `npm run test:smoke` for the most simple one. 

Ensure all other test files are passing. 

1. Spawn one subagent per failing test file in `e2e-tests/electron`. Run all agents in parallel.

Next, fixup any and all failing vite tests. `npm run test`

2. run `npm run test`, spawn one subagent per category of failing test. Run all agents in parallel.

3. Review the agents work. Look for any anti-patterns such as changing prod logic (SHOULD ABSOLUTELY NOT BE REQUIRED), tell your subagents this.

When something needs to be mocked, prefer just mocking the function response itself. 

4. If all tests are passing from `npm run test`, bump the patch (e.g. 1.0.1 -> 1.0.2) version in package.json, 
5. and then package our app by doing `cd ../../ && ./build_and_package_all.sh` you must run this in the foreground, with a 40 minute bash timeout. 
   6. fix any simple build errors that show up.