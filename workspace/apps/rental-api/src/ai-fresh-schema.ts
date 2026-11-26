/** Prisma 会整理空白、模型级属性的位置及声明顺序。
 * 新装运行边界只归一格式，保留字段、类型和属性的原 token；发行源码和 SQL 仍比较原字节。 */
function prismaSchemaTokens(schema: string) {
  if (typeof schema !== 'string' || !schema.trim()) throw Error('Prisma schema 缺失或为空');
  const token = /\s+|\/\/[^\r\n]*|"(?:[^"\\\r\n]|\\[^\r\n])*"|[A-Za-z_][A-Za-z0-9_]*|[0-9]+(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?|@@|[\[\]{}():,?.=@+\-]/uy;
  const tokens = [];
  while (token.lastIndex < schema.length) {
    const offset = token.lastIndex, match = token.exec(schema);
    if (!match) throw Error('Prisma schema 包含未支持或未闭合的 token：' + offset);
    if (!/^\s|^\/\//u.test(match[0])) tokens.push(match[0]);
  }
  if (!tokens.length) throw Error('Prisma schema 缺少实际声明');
  const normalized = [], modelAttributes = new Set(['id', 'unique', 'index', 'map', 'ignore', 'fulltext', 'schema']);
  let braceDepth = 0;
  for (let index = 0; index < tokens.length; index++) {
    const value = tokens[index];
    if (braceDepth === 0 && value === 'model' && tokens[index + 2] === '{') {
      normalized.push(value, tokens[index + 1], '{');
      const fields = [], attributes = [];
      let cursor = index + 3;
      while (cursor < tokens.length && tokens[cursor] !== '}') {
        if (tokens[cursor] !== '@@') {
          if (tokens[cursor] === '{') throw Error('Prisma 模型包含未支持的嵌套声明');
          fields.push(tokens[cursor++]);
          continue;
        }
        const name = tokens[cursor + 1];
        if (!modelAttributes.has(name)) throw Error('Prisma 模型属性未支持：' + name);
        const attribute = [tokens[cursor++], tokens[cursor++]];
        if (tokens[cursor] === '(') {
          let parentheses = 0;
          do {
            const argument = tokens[cursor++];
            if (argument === undefined || argument === '{' || argument === '}')
              throw Error('Prisma 模型属性未闭合');
            attribute.push(argument);
            if (argument === '(') parentheses++;
            else if (argument === ')') parentheses--;
          } while (parentheses > 0);
        } else if (name !== 'ignore') throw Error('Prisma 模型属性缺少参数：' + name);
        attributes.push(attribute);
      }
      if (tokens[cursor] !== '}') throw Error('Prisma 模型声明未闭合');
      // 模型属性是声明集合；每个复合键字段、枚举值及数组的顺序仍参与身份比较。
      attributes.sort((a, b) => {
        const left = JSON.stringify(a), right = JSON.stringify(b);
        return left < right ? -1 : left > right ? 1 : 0;
      });
      normalized.push(...fields, ...attributes.flat(), '}');
      index = cursor;
      continue;
    }
    normalized.push(value);
    if (value === '{') braceDepth++;
    else if (value === '}') braceDepth--;
  }
  return JSON.stringify(normalized);
}

export function samePrismaSchema(actual: string, expected: string) {
  return prismaSchemaTokens(actual) === prismaSchemaTokens(expected);
}
