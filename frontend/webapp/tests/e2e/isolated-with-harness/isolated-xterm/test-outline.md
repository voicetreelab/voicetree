# Isolated xterm.js End-to-End Test Outline

## Test Architecture

### 1. Test Environment Setup
- **Playwright Test Framework**: Use Playwright for browser automation
- **Isolated Component**: Test xterm.js Terminal component in isolation
- **Mock Electron API**: Provide mock implementation of `window.electronAPI`
- **Controlled Shell**: Use a predictable shell environment for testing

### 2. Test Structure

```
tests/e2e/isolated-xterm/
├── xterm-isolated.spec.ts     # Main test file
├── mock-electron-api.ts       # Mock Electron API implementation
├── test-harness.html          # Minimal HTML harness
└── fixtures/
    ├── terminal-fixture.ts    # Playwright fixture for terminal setup
    └── mock-shell.ts          # Mock shell process handler
```

### 3. Test Cases

#### Test Suite 1: Terminal Initialization
- **Test 1.1**: Terminal component renders correctly
- **Test 1.2**: xterm.js instance is created with correct options
- **Test 1.3**: Terminal connects to mock backend successfully
- **Test 1.4**: Initial prompt appears

#### Test Suite 2: Input/Output Operations
- **Test 2.1**: Typing text appears in terminal
- **Test 2.2**: Enter key sends command to backend
- **Test 2.3**: Backend response is displayed correctly
- **Test 2.4**: Special characters are handled properly
- **Test 2.5**: Multi-line output is rendered correctly

#### Test Suite 3: Terminal Commands
- **Test 3.1**: Echo command works
- **Test 3.2**: pwd command returns current directory
- **Test 3.3**: ls command lists files
- **Test 3.4**: Environment variables are accessible
- **Test 3.5**: Exit command closes terminal

#### Test Suite 4: Terminal Features
- **Test 4.1**: Terminal resizing works correctly
- **Test 4.2**: Copy/paste functionality
- **Test 4.3**: Scrollback buffer works
- **Test 4.4**: ANSI color codes are rendered
- **Test 4.5**: Cursor positioning works

#### Test Suite 5: Error Handling
- **Test 5.1**: Handle spawn failure gracefully
- **Test 5.2**: Handle write errors
- **Test 5.3**: Handle unexpected terminal exit
- **Test 5.4**: Handle invalid commands

### 4. Implementation Details

#### Mock Electron API Structure
```typescript
interface MockElectronAPI {
  terminal: {
    spawn: () => Promise<{ success: boolean; terminalId: string }>;
    write: (id: string, data: string) => Promise<{ success: boolean }>;
    resize: (id: string, cols: number, rows: number) => Promise<{ success: boolean }>;
    kill: (id: string) => Promise<{ success: boolean }>;
    onData: (callback: (id: string, data: string) => void) => void;
    onExit: (callback: (id: string, code: number) => void) => void;
  };
}
```

#### Test Fixture Pattern
```typescript
const test = base.extend<{
  terminalPage: Page;
  mockAPI: MockElectronAPI;
  terminalInstance: Terminal;
}>({
  // Fixture implementations
});
```

### 5. Assertions Strategy
- **Visual Assertions**: Verify terminal content using screenshots
- **Text Content**: Check terminal buffer contains expected text
- **Event Verification**: Ensure correct events are triggered
- **State Validation**: Verify terminal state after operations

### 6. Test Data
- **Command Sets**: Predefined commands with expected outputs
- **Test Files**: Sample directory structure for ls/pwd tests
- **ANSI Sequences**: Test data for color/formatting verification

### 7. Performance Considerations
- **Timeout Configuration**: Appropriate timeouts for async operations
- **Resource Cleanup**: Proper disposal of terminal instances
- **Parallel Execution**: Tests should be parallelizable

### 8. Debugging Support
- **Console Logging**: Capture terminal I/O for debugging
- **Screenshot on Failure**: Automatic screenshots when tests fail
- **Trace Recording**: Playwright trace for complex scenarios

## Benefits of This Approach

1. **Fast Execution**: No need to start full Electron app
2. **Reliable**: Controlled environment reduces flakiness
3. **Focused**: Tests only xterm.js functionality
4. **Maintainable**: Clear separation of concerns
5. **Debuggable**: Easy to isolate and fix issues

## Next Steps

1. Implement mock-electron-api.ts
2. Create test-harness.html
3. Write terminal-fixture.ts
4. Implement first test suite
5. Run and validate tests