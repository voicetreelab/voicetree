import * as fs from 'fs/promises';
import * as path from 'path';

export async function writeInitialLinkedProject(writeFolderPath: string): Promise<void> {
  await fs.writeFile(
    path.join(writeFolderPath, 'linking-node.md'),
    `# Linking Node

This node links to a node in the readPath:

- references [[linked-node]]
`
  );
}

export async function writeLinkedReadProject(readPath: string): Promise<void> {
  await fs.writeFile(
    path.join(readPath, 'linked-node.md'),
    `# Linked Node

This node is linked from the writeFolderPath and should be lazy-loaded.
`
  );

  await fs.writeFile(
    path.join(readPath, 'unlinked-node.md'),
    `# Unlinked Node

This node has NO links pointing to it.
It should NOT be loaded when lazy loading is working correctly.
`
  );
}

export async function writeInitialFileChangeProject(writeFolderPath: string): Promise<void> {
  await fs.writeFile(
    path.join(writeFolderPath, 'source-node.md'),
    `# Source Node

This node starts with NO links to readPath.
`
  );
}

export async function writeFileChangeReadProject(readPath: string): Promise<void> {
  await fs.writeFile(
    path.join(readPath, 'target-node.md'),
    `# Target Node

This should be lazy loaded when source-node links to it.
`
  );
}

export async function createTransitiveReadProject(testDir: string, writeFolderPath: string): Promise<string> {
  const readPath = path.join(testDir, 'transitive-project');
  await fs.mkdir(readPath, { recursive: true });

  await fs.writeFile(
    path.join(writeFolderPath, 'linking-node.md'),
    `# Node A

Links to [[b]] in readPath.
`
  );

  await fs.writeFile(
    path.join(readPath, 'b.md'),
    `# Node B

This links to [[c]] transitively.
`
  );

  await fs.writeFile(
    path.join(readPath, 'c.md'),
    `# Node C

End of transitive chain.
`
  );

  await fs.writeFile(
    path.join(readPath, 'orphan.md'),
    `# Orphan Node

Nobody links to this node.
`
  );

  return readPath;
}

export async function linkSourceNodeToTarget(writeFolderPath: string): Promise<void> {
  await fs.writeFile(
    path.join(writeFolderPath, 'source-node.md'),
    `# Source Node

This node now links to [[target-node]] in readPath!
`
  );
}
