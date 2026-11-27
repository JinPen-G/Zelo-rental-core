'use strict';
/** 独立仓开发入口：只执行显式固定的框架工具，组合两个完整Git提交。
 * 不把当前检出/WIP当固定来源，不安装依赖、生成Client或启动服务。 */
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const { createRequire } = require('node:module');

function main(args) {
  const values = {}, forward = [];
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    if (key === '--ai' || key === '--fresh-ai' || key === '--mcp' || key === '--with-tests') { forward.push(key); continue; }
    const value = args[++index];
    if (!['--framework-repo', '--framework-commit', '--repository', '--core-commit', '--out', '--profile', '--mode'].includes(key)
      || values[key] || !value || value.startsWith('--')) throw Error('未知、重复或缺值的开发准备参数');
    values[key] = value;
  }
  const framework = values['--framework-repo'], commit = values['--framework-commit'];
  if (!framework || !/^[a-f0-9]{40}$/u.test(commit ?? '') || !/^[a-f0-9]{40}$/u.test(values['--core-commit'] ?? ''))
    throw Error('须提供 --framework-repo、--framework-commit 和 --core-commit 两个完整SHA');
  const repository = path.resolve(framework);
  const actual = execFileSync('git', ['--no-replace-objects', 'rev-parse', '--verify', commit + '^{commit}'],
    { cwd: repository, encoding: 'utf8', windowsHide: true }).trim();
  if (actual !== commit) throw Error('框架须固定提交对象，不能使用Tag对象或浮动引用');
  const read = file => execFileSync('git', ['--no-replace-objects', 'show', commit + ':' + file],
    { cwd: repository, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, windowsHide: true });
  const native = createRequire(path.join(repository, 'package.json')), modules = new Map();
  function load(file) {
    if (!/^scripts\/[a-z0-9-]+\.cjs$/u.test(file)) throw Error('只允许固定框架的正式构建脚本');
    if (modules.has(file)) return modules.get(file).exports;
    const module = { exports: {} }; modules.set(file, module);
    const filename = path.join(repository, file);
    const requireFixed = name => name.startsWith('.')
      ? load(path.posix.normalize(path.posix.join(path.posix.dirname(file), name))) : native(name);
    new vm.Script('(function(require,module,exports,__dirname,__filename){' + read(file) + '\n})', { filename })
      .runInThisContext()(requireFixed, module, module.exports, path.dirname(filename), filename);
    return module.exports;
  }
  for (const [key, value] of Object.entries(values)) {
    if (key === '--framework-repo') forward.push('--repo', repository);
    else if (key === '--framework-commit') forward.push('--commit', value);
    else forward.push(key, value);
  }
  forward.push('--core-repo', path.resolve(__dirname, '..'));
  const tool = load('scripts/prepare-rental-workspace.cjs');
  if (typeof tool.main !== 'function') throw Error('所选框架提交尚未提供双仓开发入口，请选择包含该工具的固定提交');
  return tool.main(forward);
}
if (require.main === module) Promise.resolve().then(() => main(process.argv.slice(2)))
  .catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { main };
