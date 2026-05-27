import * as path from 'path';

import { loadPerfTestConfig } from '../perf-helpers/perfConfig';

export const PROJECT_ROOT = path.resolve(process.cwd());
export const PERF_CONFIG = loadPerfTestConfig(PROJECT_ROOT);
export const PERF_TRACES_DIR = PERF_CONFIG.outputDir;
export const FIXTURE_VAULT_PATH = path.join(PROJECT_ROOT, 'example_folder_fixtures', 'example_small');
