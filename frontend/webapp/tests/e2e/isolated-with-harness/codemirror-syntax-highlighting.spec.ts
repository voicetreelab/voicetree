import { test, expect } from '@playwright/test';

test('CodeMirror syntax highlighting visual test', async ({ page }) => {
  // Create a simple HTML page with CodeMirror editor
  await page.setContent(`
    <!DOCTYPE html>
    <html>
      <head>
        <style>
          #editor { width: 600px; height: 400px; border: 1px solid #ccc; }
        </style>
      </head>
      <body>
        <h1>CodeMirror Syntax Highlighting Test</h1>
        <div id="editor"></div>
        <script type="module">
          import { CodeMirrorEditorView } from '/src/views/CodeMirrorEditorView.ts';

          const content = \`# Test Document

\\\`\\\`\\\`typescript
class MermaidBlockWidget extends WidgetType {
  constructor(public source: string) {
    console.log("Hello");
  }
}
\\\`\\\`\\\`

\\\`\\\`\\\`python
def hello_world():
    print("Hello, World!")
    return True
\\\`\\\`\\\`
\`;

          const editor = new CodeMirrorEditorView(
            document.getElementById('editor'),
            content
          );

          window.editor = editor;
        </script>
      </body>
    </html>
  `);

  // Wait for editor to load
  await page.waitForSelector('.cm-editor', { timeout: 5000 });

  // Wait a bit for syntax highlighting to apply
  await page.waitForTimeout(1000);

  // Take a screenshot to verify visually
  await page.screenshot({ path: 'syntax-highlighting-test.png', fullPage: true });

  // Check for syntax highlighting classes
  const editorHTML = await page.locator('#editor').innerHTML();

  console.log('=== Checking for syntax token classes ===');

  // Check for CodeMirror token classes
  const hasTokenClasses =
    editorHTML.includes('tok-') ||
    editorHTML.includes('cm-fencedCode') ||
    editorHTML.includes('ͼ'); // CodeMirror uses unicode markers

  console.log('Has token classes:', hasTokenClasses);
  console.log('HTML length:', editorHTML.length);

  // Print first 1000 chars of HTML
  console.log('First 1000 chars:', editorHTML.substring(0, 1000));

  expect(hasTokenClasses).toBe(true);
});
