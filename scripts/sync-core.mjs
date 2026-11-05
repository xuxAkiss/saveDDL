/**
 * 把 `packages/core/src/ddl.js` 同步到 DSH 插件里。
 *
 * DSH 插件以「目录 bundle」安装，不应依赖 workspace 协议或构建步骤；
 * 因此这里保留一份带来源说明的生成副本。修改核心解析器后运行：
 *
 *   node scripts/sync-core.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const source = path.join(root, 'packages', 'core', 'src', 'ddl.js');
const target = path.join(root, 'plugins', 'dsh-save-ddl', 'lib', 'core.js');

const banner = `/**
 * 此文件由 scripts/sync-core.mjs 从 packages/core/src/ddl.js 生成。
 * 请修改源文件后重新生成，不要直接编辑这里。
 */
`;

fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, banner + fs.readFileSync(source, 'utf8'), 'utf8');
console.log(`synced ${path.relative(root, source)} -> ${path.relative(root, target)}`);