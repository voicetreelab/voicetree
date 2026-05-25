import * as path from 'path';

export const PROJECT_ROOT = path.resolve(process.cwd());
export const CI_FLAGS = process.env.CI
    ? ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader']
    : [];
