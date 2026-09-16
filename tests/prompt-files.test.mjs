import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const require = createRequire(resolve('package.json'));
const ts = require('typescript');
const promptFiles = {};
vm.runInNewContext(ts.transpileModule(readFileSync(resolve('src/library/promptFiles.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports: promptFiles });
const { isPromptFilePath, parsePromptFile } = promptFiles;

test('frontmatter name becomes the title and the body keeps its text', () => {
  const parsed = parsePromptFile('skills/simple/SKILL.md', '---\nname: "simple"\ndescription: Rewrite text.\nmetadata:\n  name: nested\n---\n\n# Humanizer\n\nKeep $ARGUMENTS verbatim.\n');
  assert.equal(parsed.title, 'simple');
  assert.equal(parsed.content, '# Humanizer\n\nKeep $ARGUMENTS verbatim.');
  assert.equal(parsed.suggested, true);
});

test('a skill file without a name takes its folder name and other files take their stem', () => {
  assert.equal(parsePromptFile('skills/design-doc/SKILL.md', 'Body').title, 'design-doc');
  assert.equal(parsePromptFile('prompts/fix-tests.md', 'Body').title, 'fix-tests');
  assert.equal(parsePromptFile('SKILL.md', 'Body').title, 'SKILL');
  assert.equal(parsePromptFile('a/blank-name.md', '---\nname:\n---\nBody').title, 'blank-name');
});

test('windows line endings parse and unterminated frontmatter stays in the body', () => {
  const parsed = parsePromptFile('a/review.md', '---\r\nname: review\r\n---\r\nLine one\r\nLine two\r\n');
  assert.equal(parsed.title, 'review');
  assert.equal(parsed.content, 'Line one\nLine two');
  const open = parsePromptFile('a/open.md', '---\nname: open\nno closing marker');
  assert.equal(open.title, 'open');
  assert.equal(open.content, '---\nname: open\nno closing marker');
});

test('files without prompt text are rejected', () => {
  assert.equal(parsePromptFile('a/empty.md', '---\nname: empty\n---\n\n'), null);
  assert.equal(parsePromptFile('a/blank.md', '   \n'), null);
});

test('repository boilerplate is listed but not suggested', () => {
  assert.equal(parsePromptFile('skills/README.md', 'About').suggested, false);
  assert.equal(parsePromptFile('skills/LICENSE.md', 'MIT').suggested, false);
  assert.equal(parsePromptFile('skills/AGENTS.md', 'Rules').suggested, true);
});

test('only markdown and text files outside hidden folders qualify', () => {
  assert.equal(isPromptFilePath('skills/simple/SKILL.md'), true);
  assert.equal(isPromptFilePath('notes.txt'), true);
  assert.equal(isPromptFilePath('.claude/skills/simple/SKILL.md'), true);
  assert.equal(isPromptFilePath('skills/.system/skill/SKILL.md'), false);
  assert.equal(isPromptFilePath('skills/.DS_Store'), false);
  assert.equal(isPromptFilePath('skills/render.mjs'), false);
});

test('files inside a skill folder other than its SKILL.md are support files', () => {
  const { findSkillSupportPaths } = promptFiles;
  const paths = ['skills/README.md', 'skills/design-doc/SKILL.md', 'skills/design-doc/references/spec.md', 'skills/design-doc/scripts/render.mjs', 'skills/simple/SKILL.md', 'skills/notes.md'];
  assert.deepEqual([...findSkillSupportPaths(paths)].sort(), ['skills/design-doc/references/spec.md', 'skills/design-doc/scripts/render.mjs']);
  assert.deepEqual([...findSkillSupportPaths(['SKILL.md', 'other.md'])], []);
});
