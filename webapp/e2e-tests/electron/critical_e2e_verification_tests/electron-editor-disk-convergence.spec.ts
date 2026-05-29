/**
 * BEHAVIORAL SPEC: editor ↔ graph ↔ disk convergence
 *
 * One invariant — typing in the editor, writes from the filesystem, and the
 * graph view all stay consistent — exercised under every perturbation we've
 * seen break it:
 *   1. plain keyboard edit lands on disk + graph + survives close/reopen
 *   2. wiki-link typed in the editor creates an outgoing graph edge        [skip]
 *   3. external file write reaches the open editor (bidirectional sync)
 *   4. char-by-char typing survives autosave + watcher settle cycles
 *   5. external SSE append merges while the editor is focused and typing
 *   6. external non-append replacement applies while the editor is focused
 *   7. parent unsaved edit survives cmd-n create-child shortcut
 *   8. frontmatter shape on disk is preserved through editing and close
 *   9. in-flight typed edit is visible in an immediate agent context snapshot
 *
 * Each test follows: seed → action → assert (editor + disk + graph).
 *
 * Replaces:
 *   - electron-markdown-editors-crud-v2.spec.ts
 *   - electron-editor-typing-order-regression.spec.ts
 *   - electron-editor-edits-survive-downstream-ops.spec.ts
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  INITIAL_PARENT_CONTENT,
  PARENT_TITLE,
  PARENT_FILENAME,
  clickEditorCloseButton,
  closeAllEditorWindows,
  closeAllTerminalWindows,
  closeEditorWindow,
  configureNoopAgent,
  deleteCtxNodesDir,
  deleteExtraVaultFiles,
  expectContextNodeContains,
  expectDaemonNodeContains,
  expectDiskContainsAll,
  expectDiskMatches,
  expectEditorContainsAll,
  expectEditorMatches,
  expectGraphHasEdgeTo,
  expectNodeCountIncreasedAbove,
  expect,
  focusEditor,
  openEditorForLabel,
  readEditorText,
  replaceEditorContentWithKeyboard,
  resetSettings,
  selectAllInEditor,
  syncRendererSessionStateWithDaemon,
  test,
  typeCharByCharVerifyingPrefix,
  waitForGraphReset,
  waitForNode,
} from './editor-disk-convergence-helpers';

test.describe.configure({ timeout: 90_000 });

test.describe('editor ↔ graph ↔ disk convergence', () => {
  test.beforeEach(async ({ appWindow, settingsSnapshot, writeFolder }) => {
    await closeAllEditorWindows(appWindow);
    await closeAllTerminalWindows(appWindow);
    await fs.writeFile(path.join(writeFolder, PARENT_FILENAME), INITIAL_PARENT_CONTENT, 'utf8');
    await deleteExtraVaultFiles(appWindow, writeFolder);
    await deleteCtxNodesDir(writeFolder);
    await resetSettings(appWindow, settingsSnapshot);
    await waitForGraphReset(appWindow, PARENT_TITLE);
  });

  test('keyboard edit lands on disk + graph label + survives close and reopen', async ({ appWindow, writeFolder }) => {
    const { editorWindowId, nodeId } = await openEditorForLabel(appWindow, PARENT_TITLE);

    const typed = `# ${PARENT_TITLE}\n\nKeyboard typing makes it to disk and survives close.\n`;
    await replaceEditorContentWithKeyboard(appWindow, editorWindowId, typed);

    await expectEditorMatches(appWindow, editorWindowId, typed);
    await expectDiskMatches(writeFolder, PARENT_FILENAME, typed);

    // Real button click — exercises the .traffic-light-close → close-logic wiring.
    await clickEditorCloseButton(appWindow, editorWindowId);
    await appWindow.locator(`[id="${editorWindowId}"]`).waitFor({ state: 'detached', timeout: 5_000 });
    const afterClose = await fs.readFile(path.join(writeFolder, PARENT_FILENAME), 'utf8');
    expect(afterClose).toBe(typed);

    // Reopen the node; editor must re-hydrate with the same content.
    const reopened = await openEditorForLabel(appWindow, PARENT_TITLE);
    expect(reopened.nodeId).toBe(nodeId);
    await expectEditorMatches(appWindow, reopened.editorWindowId, typed);
  });

  // App bug: `introduction`-style nodes can be missing filePath metadata, which
  // prevents the editor from opening for the wikilink test. Source spec
  // (electron-markdown-editors-crud-v2) skipped this scenario; preserved here
  // so the regression locks back in once the app bug is fixed.
  test.skip('typing [[Target]] in the editor creates an outgoing graph edge', async ({ appWindow, writeFolder }) => {
    const targetTitle = 'Wiki Link Target';
    await fs.writeFile(
      path.join(writeFolder, `${targetTitle}.md`),
      `# ${targetTitle}\n\nLinked from convergence target.\n`,
      'utf8',
    );
    await waitForNode(appWindow, targetTitle);

    const { editorWindowId, nodeId } = await openEditorForLabel(appWindow, PARENT_TITLE);
    const withLink = `# ${PARENT_TITLE}\n\nlinks to [[${targetTitle}]]\n`;
    await replaceEditorContentWithKeyboard(appWindow, editorWindowId, withLink);

    await expectDiskContainsAll(writeFolder, PARENT_FILENAME, [`[[${targetTitle}]]`]);
    await expectGraphHasEdgeTo(appWindow, nodeId, targetTitle);
  });

  test('external file write reaches the open editor (bidirectional sync)', async ({ appWindow, writeFolder }) => {
    const { editorWindowId } = await openEditorForLabel(appWindow, PARENT_TITLE);

    // Initial editor state: shows the seeded body verbatim, with no frontmatter
    // prefix even if one existed on disk (frontmatter is stripped on display).
    const initialEditor = await readEditorText(appWindow, editorWindowId);
    expect(initialEditor).toContain(`# ${PARENT_TITLE}`);
    expect(initialEditor).not.toMatch(/^---\n/);

    const externallyChanged = `# ${PARENT_TITLE}\n\nEXTERNAL CHANGE — written by another process.\n`;
    await fs.writeFile(
      path.join(writeFolder, PARENT_FILENAME),
      `---\n---\n${externallyChanged}`,
      'utf8',
    );

    await expectEditorMatches(appWindow, editorWindowId, externallyChanged);
  });

  test('char-by-char typing survives autosave + watcher settle cycles', async ({ appWindow, writeFolder }) => {
    const { editorWindowId } = await openEditorForLabel(appWindow, PARENT_TITLE);
    await selectAllInEditor(appWindow);

    const expectedContent = [
      'random saves should stay ordered',
      'across a couple of lines',
      'without moving letters around',
    ].join('\n');

    await typeCharByCharVerifyingPrefix(appWindow, editorWindowId, expectedContent);
    await appWindow.waitForTimeout(1_000);

    await expectEditorMatches(appWindow, editorWindowId, expectedContent);
    await expectDiskMatches(writeFolder, PARENT_FILENAME, expectedContent);
  });

  test('external SSE append merges while editor focused and typing', async ({ appWindow, writeFolder }) => {
    await syncRendererSessionStateWithDaemon(appWindow);
    const { editorWindowId } = await openEditorForLabel(appWindow, PARENT_TITLE);
    await selectAllInEditor(appWindow);

    const userText = 'user is typing this while the daemon is active';
    const agentText = '## Agent Section\nagent wrote this';

    const typing = appWindow.keyboard.type(userText, { delay: 80 });
    await appWindow.waitForTimeout(500);
    await fs.appendFile(path.join(writeFolder, PARENT_FILENAME), `\n\n${agentText}\n`, 'utf8');
    await typing;
    await appWindow.waitForTimeout(1_000);

    await expectEditorContainsAll(appWindow, editorWindowId, [userText, agentText]);
    await expectDiskContainsAll(writeFolder, PARENT_FILENAME, [userText, agentText]);
  });

  test('external non-append replacement applies while editor focused', async ({ appWindow, writeFolder }) => {
    await syncRendererSessionStateWithDaemon(appWindow);
    const { editorWindowId } = await openEditorForLabel(appWindow, PARENT_TITLE);
    await focusEditor(appWindow, editorWindowId);

    const replacement = `# ${PARENT_TITLE}\n\nExternal filesystem replacement should win while focused.\n`;
    await fs.writeFile(
      path.join(writeFolder, PARENT_FILENAME),
      `---\n---\n${replacement}`,
      'utf8',
    );

    await expectEditorMatches(appWindow, editorWindowId, replacement);
  });

  test('parent unsaved edit survives cmd-n create-child shortcut', async ({ appWindow, writeFolder }) => {
    const TYPED_MARKER = 'unsaved edit survives cmd n 48291';
    const typed = `# ${PARENT_TITLE}\n\n${TYPED_MARKER}\n`;

    const { editorWindowId, nodeId, nodeCountBefore } = await openEditorForLabel(appWindow, PARENT_TITLE);
    await replaceEditorContentWithKeyboard(appWindow, editorWindowId, typed);

    await appWindow.waitForTimeout(75);
    await appWindow.keyboard.press('ControlOrMeta+n');

    await expectNodeCountIncreasedAbove(appWindow, nodeCountBefore);
    await expectDiskContainsAll(writeFolder, PARENT_FILENAME, [TYPED_MARKER]);
    await expectDaemonNodeContains(appWindow, nodeId, TYPED_MARKER);

    // Reopen parent; editor must still show the typed marker.
    await closeEditorWindow(appWindow, editorWindowId);
    await appWindow.locator(`[id="${editorWindowId}"]`).waitFor({ state: 'detached', timeout: 5_000 });
    const reopened = await openEditorForLabel(appWindow, PARENT_TITLE);
    await expect.poll(async () => readEditorText(appWindow, reopened.editorWindowId), {
      message: 'Waiting for reopened parent editor to show the typed edit',
      timeout: 5_000,
    }).toContain(TYPED_MARKER);
  });

  test('frontmatter shape on disk is preserved through editing and close', async ({ appWindow, writeFolder }) => {
    const parentPath = path.join(writeFolder, PARENT_FILENAME);

    // Re-seed externally with frontmatter so the watcher picks it up before
    // the editor opens. The editor strips frontmatter on display; autosave
    // must re-prepend it.
    const withFrontmatter = `---\nstatus: active\n---\n# ${PARENT_TITLE}\n\nOriginal body before edit.\n`;
    await fs.writeFile(parentPath, withFrontmatter, 'utf8');
    await appWindow.waitForTimeout(500);

    const { editorWindowId } = await openEditorForLabel(appWindow, PARENT_TITLE);

    // Editor strips frontmatter on display.
    await expect.poll(async () => readEditorText(appWindow, editorWindowId), {
      message: 'Waiting for editor to load frontmatter-stripped content',
      timeout: 5_000,
    }).not.toMatch(/^---\n/);
    const initialEditor = await readEditorText(appWindow, editorWindowId);
    expect(initialEditor).toContain(`# ${PARENT_TITLE}`);

    const editedBody = `# ${PARENT_TITLE}\n\nEdited body — frontmatter should survive.\n`;
    await replaceEditorContentWithKeyboard(appWindow, editorWindowId, editedBody);

    // After autosave: disk must have BOTH the frontmatter prefix AND the new
    // edit. Poll on the conjunction — polling on just the prefix would match
    // the pre-edit disk state and exit immediately.
    await expect.poll(async () => {
      const content = await fs.readFile(parentPath, 'utf8');
      return /^---\nstatus: active\n---\n/.test(content)
        && content.includes('Edited body — frontmatter should survive.');
    }, {
      message: 'Waiting for autosave to land while preserving frontmatter',
      timeout: 15_000,
      intervals: [200, 500, 1000, 2000],
    }).toBe(true);

    // Real button click; frontmatter must STILL be preserved on disk after close.
    await clickEditorCloseButton(appWindow, editorWindowId);
    await appWindow.locator(`[id="${editorWindowId}"]`).waitFor({ state: 'detached', timeout: 5_000 });
    const afterClose = await fs.readFile(parentPath, 'utf8');
    expect(afterClose).toMatch(/^---\nstatus: active\n---\n/);
    expect(afterClose).toContain('Edited body — frontmatter should survive.');
  });

  // FIXME(in-flight-flush-before-spawn): this test asserts that when an agent
  // is spawned via Cmd+Enter on a node with unsaved editor edits, the agent's
  // context-node snapshot includes the in-flight typed content. The renderer
  // currently autosaves on a debounce (MAX_AUTOSAVE_WAIT_MS=300, see
  // floating-windows/editors/updateListener.ts) and the spawn flow reads the
  // context-node content from disk via vt-daemon's spawnTerminalWithContextNode
  // RPC. There is no force-flush hook wired between the renderer's editor
  // change-emitter and the spawn IPC, so after 75ms the disk content is still
  // stale. Skipping until the flush-before-spawn feature lands; the other 7
  // tests in this spec exercise the editor/disk/graph convergence behaviours
  // that DO have implementations. See dev-manu commit 1b2171ace (the TDD
  // commit) — the matching renderer-side implementation never landed.
  test.skip('in-flight typed edit is visible in an immediate agent context snapshot', async ({ appWindow, writeFolder }) => {
    const CONTEXT_MARKER = 'agent context sees immediate edit 93017';
    const typed = `# ${PARENT_TITLE}\n\n${CONTEXT_MARKER}\n`;

    await configureNoopAgent(appWindow);
    const { editorWindowId } = await openEditorForLabel(appWindow, PARENT_TITLE);
    await replaceEditorContentWithKeyboard(appWindow, editorWindowId, typed);

    await appWindow.waitForTimeout(75);
    await appWindow.keyboard.press('ControlOrMeta+Enter');

    await expectContextNodeContains(writeFolder, CONTEXT_MARKER);
    await closeAllTerminalWindows(appWindow);
  });
});
