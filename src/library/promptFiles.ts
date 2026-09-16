export type ParsedPromptFile = {
  path: string;
  title: string;
  content: string;
  suggested: boolean;
};

export function isPromptFilePath(path: string): boolean {
  const segments = path.split('/');
  if (segments.slice(1).some((segment) => segment.startsWith('.'))) {
    return false;
  }
  const name = segments[segments.length - 1].toLowerCase();
  return ['.md', '.markdown', '.txt'].some((extension) => name.endsWith(extension));
}

export function findSkillSupportPaths(paths: string[]): Set<string> {
  const support = new Set<string>();
  for (const skillFile of paths.filter((path) => /\/SKILL\.md$/i.test(path))) {
    const directory = skillFile.slice(0, skillFile.lastIndexOf('/') + 1);
    for (const path of paths) {
      if (path !== skillFile && path.startsWith(directory)) {
        support.add(path);
      }
    }
  }
  return support;
}

export function parsePromptFile(path: string, text: string): ParsedPromptFile | null {
  const lines = text.split(/\r?\n/);
  let bodyStart = 0;
  let name = '';
  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
    if (end > 0) {
      bodyStart = end + 1;
      for (const line of lines.slice(1, end)) {
        const match = /^name:\s*(.*?)\s*$/.exec(line);
        if (!match) {
          continue;
        }
        const raw = match[1];
        name = /^(["']).*\1$/.test(raw) ? raw.slice(1, -1) : raw;
      }
    }
  }
  const content = lines.slice(bodyStart).join('\n').trim();
  if (!content) {
    return null;
  }
  const segments = path.split('/');
  const stem = segments[segments.length - 1].replace(/\.[^.]+$/, '');
  const folder = segments.length > 1 ? segments[segments.length - 2] : '';
  const title = name.trim() || (stem.toUpperCase() === 'SKILL' && folder ? folder : stem);
  const suggested = !['readme', 'license', 'contributing', 'code_of_conduct', 'changelog'].includes(stem.toLowerCase());
  return { path, title, content, suggested };
}
