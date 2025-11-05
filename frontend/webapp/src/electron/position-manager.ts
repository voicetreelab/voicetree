import { promises as fs } from 'fs';
import path from 'path';

/**
 * PositionManager - Saves and loads node positions to/from .voicetree/graph_data.json
 *
 * Simple data structure: { [filename]: { x: number, y: number } }
 */

export interface NodePosition {
  x: number;
  y: number;
}

export interface PositionData {
  [filename: string]: NodePosition;
}

class PositionManager {
  private static readonly VOICETREE_DIR = '.voicetree';
  private static readonly GRAPH_DATA_FILE = 'graph_data.json';

  /**
   * Get the path to .voicetree/graph_data.json for a given directory
   */
  private getGraphDataPath(directoryPath: string): string {
    return path.join(directoryPath, PositionManager.VOICETREE_DIR, PositionManager.GRAPH_DATA_FILE);
  }

  /**
   * Ensure .voicetree directory exists
   */
  private async ensureVoicetreeDir(directoryPath: string): Promise<void> {
    const voicetreePath = path.join(directoryPath, PositionManager.VOICETREE_DIR);
    try {
      await fs.mkdir(voicetreePath, { recursive: true });
    } catch (error) {
      console.error('[PositionManager] Failed to create .voicetree directory:', error);
      throw error;
    }
  }

  /**
   * Save node positions to disk
   * @param directoryPath - The watched directory
   * @param positions - Map of filename to position
   */
  async savePositions(directoryPath: string, positions: PositionData): Promise<void> {
    try {
      await this.ensureVoicetreeDir(directoryPath);
      const graphDataPath = this.getGraphDataPath(directoryPath);

      const jsonContent = JSON.stringify(positions, null, 2);
      await fs.writeFile(graphDataPath, jsonContent, 'utf8');

      console.log(`[PositionManager] Saved ${Object.keys(positions).length} node positions to ${graphDataPath}`);
    } catch (error) {
      console.error('[PositionManager] Failed to save positions:', error);
      throw error;
    }
  }

  /**
   * Load node positions from disk
   * @param directoryPath - The watched directory
   * @returns Map of filename to position, or empty object if file doesn't exist
   */
  async loadPositions(directoryPath: string): Promise<PositionData> {
    try {
      const graphDataPath = this.getGraphDataPath(directoryPath);
      const content = await fs.readFile(graphDataPath, 'utf8');
      const positions = JSON.parse(content) as PositionData;

      console.log(`[PositionManager] Loaded ${Object.keys(positions).length} node positions from ${graphDataPath}`);
      return positions;
    } catch (error) {
      // File doesn't exist or is invalid - return empty object
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        console.log('[PositionManager] No saved positions found (first time for this directory)');
      } else {
        console.error('[PositionManager] Failed to load positions:', error);
      }
      return {};
    }
  }

  /**
   * Update a single node position
   * Loads existing positions, updates the specified one, and saves back
   * @param directoryPath - The watched directory
   * @param filename - Relative filename (e.g., "_1.md")
   * @param position - Node position {x, y}
   */
  async updatePosition(directoryPath: string, filename: string, position: NodePosition): Promise<void> {
    try {
      // Load existing positions
      const positions = await this.loadPositions(directoryPath);

      // Update the specific node
      positions[filename] = position;

      // Save back
      await this.savePositions(directoryPath, positions);

      console.log(`[PositionManager] Updated position for ${filename} to (${position.x}, ${position.y})`);
    } catch (error) {
      console.error('[PositionManager] Failed to update position:', error);
      throw error;
    }
  }
}

export default PositionManager;
