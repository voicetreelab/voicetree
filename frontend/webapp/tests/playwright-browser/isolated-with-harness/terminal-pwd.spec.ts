import { test, expect } from '@playwright/test';

test.describe('Terminal - pwd command test', () => {
  test('should execute pwd command and display current directory', async ({ page }) => {
    // Navigate to the terminal harness
    await page.goto('/tests/e2e/isolated-with-harness/harness.html?component=terminal-harness');

    // Wait for terminal to be ready
    await page.waitForSelector('#terminal-container', { timeout: 10000 });

    // Wait for status to show terminal is ready
    await page.waitForFunction(() => {
      const statusElement = document.querySelector('#status');
      return statusElement?.textContent?.includes('Terminal ready for testing');
    }, { timeout: 10000 });

    // Execute pwd command using the test utilities
    const output = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const testWindow = window as any;

      if (!testWindow._test_terminal) {
        throw new Error('Test terminal utilities not available');
      }

      // Execute pwd command
      await testWindow._test_terminal.executeCommand('pwd');

      // Wait for output
      try {
        const output = await testWindow._test_terminal.waitForOutput(/\/.*/, 3000);
        return output;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (error: any) {
        throw new Error(`Failed to get pwd output: ${error.message}`);
      }
    });

    console.log('PWD output:', output);

    // Verify output contains a valid absolutePath
    expect(output).toBeTruthy();
    expect(output).toMatch(/\//); // Should contain at least one slash (Unix absolutePath)

    // The output should be a valid absolutePath starting with /
    // On macOS it might be something like /Users/username/...
    // On Linux it might be /home/username/...
    const lines = output.split('\n').filter(line => line.trim());
    const pwdLine = lines.find(line => line.startsWith('/'));

    expect(pwdLine).toBeTruthy();
    expect(pwdLine).toMatch(/^\/[\w\-/.]+/); // Basic absolutePath validation
  });

  test('should handle multiple commands in sequence', async ({ page }) => {
    // Navigate to the terminal harness
    await page.goto('/tests/e2e/isolated-with-harness/harness.html?component=terminal-harness');

    // Wait for terminal to be ready
    await page.waitForSelector('#terminal-container', { timeout: 10000 });

    await page.waitForFunction(() => {
      const statusElement = document.querySelector('#status');
      return statusElement?.textContent?.includes('Terminal ready for testing');
    }, { timeout: 10000 });

    // Execute multiple commands
    const results = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const testWindow = window as any;

      if (!testWindow._test_terminal) {
        throw new Error('Test terminal utilities not available');
      }

      const outputs: string[] = [];

      // Execute pwd
      await testWindow._test_terminal.executeCommand('pwd');
      const pwdOutput = await testWindow._test_terminal.waitForOutput(/\/.*/, 3000);
      outputs.push(pwdOutput);

      // Execute echo
      await testWindow._test_terminal.executeCommand('echo "Hello from test"');
      const echoOutput = await testWindow._test_terminal.waitForOutput('Hello from test', 3000);
      outputs.push(echoOutput);

      return outputs;
    });

    // Verify pwd output
    expect(results[0]).toMatch(/\//);

    // Verify echo output
    expect(results[1]).toContain('Hello from test');
  });

  test('should display terminal output correctly in the UI', async ({ page }) => {
    // Navigate to the terminal harness
    await page.goto('/tests/e2e/isolated-with-harness/harness.html?component=terminal-harness');

    // Wait for terminal to be ready
    await page.waitForSelector('#terminal-container', { timeout: 10000 });

    await page.waitForFunction(() => {
      const statusElement = document.querySelector('#status');
      return statusElement?.textContent?.includes('Terminal ready for testing');
    }, { timeout: 10000 });

    // Execute pwd and verify it appears in the terminal
    await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const testWindow = window as any;
      await testWindow._test_terminal.executeCommand('pwd');
      await testWindow._test_terminal.waitForOutput(/\/.*/, 3000);
    });

    // Check that the terminal container has content
    const terminalContent = await page.$eval('#terminal-container', el => {
      // xterm creates canvas elements for rendering
      const canvasElements = el.querySelectorAll('canvas');
      return canvasElements.length > 0;
    });

    expect(terminalContent).toBe(true);
  });
});