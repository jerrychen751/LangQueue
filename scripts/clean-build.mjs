import { readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

for (const entry of readdirSync('dist', { recursive: true, withFileTypes: true })) {
  if (entry.isFile() && ['.DS_Store', '.gitkeep'].includes(entry.name)) {
    unlinkSync(join(entry.parentPath, entry.name));
  }
}
