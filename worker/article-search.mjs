import { ApiError, decode } from './core.mjs';
const fail = (
  message = '検索条件を確認してください。',
  code = 'invalid_search_filters',
) => {
  throw new ApiError(400, code, message);
};
export function parseExpression(input) {
  if (input.length > 500)
    fail(
      'キーワードは500文字以内にしてください。',
      'invalid_search_query',
    );
  const tokens = [];
  let index = 0,
    words = 0;
  while (index < input.length) {
    const char = input[index];
    if (/\s/.test(char)) {
      index++;
      continue;
    }
    if (char === '(' || char === ')') {
      tokens.push({ type: char });
      index++;
      continue;
    }
    if (char === '"') {
      let word = '';
      index++;
      let closed = false;
      while (index < input.length) {
        if (input[index] === '"') {
          closed = true;
          index++;
          break;
        }
        if (input[index] === '\\' && input[index + 1] === '"') {
          word += '"';
          index += 2;
        } else word += input[index++];
      }
      if (!closed || !word.trim())
        fail(
          '引用符で囲んだ語句を確認してください。',
          'invalid_search_query',
        );
      tokens.push({ type: 'word', value: word });
      words++;
      continue;
    }
    let word = '';
    while (index < input.length && !/[\s()"]/.test(input[index]))
      word += input[index++];
    const upper = word.toUpperCase();
    if (['AND', 'OR', 'NOT'].includes(upper))
      tokens.push({ type: upper });
    else {
      tokens.push({ type: 'word', value: word });
      words++;
    }
  }
  if (words > 12 || tokens.length > 50)
    fail(
      'キーワードは最大12個、かっこは簡潔に指定してください。',
      'invalid_search_query',
    );
  if (!tokens.length) return null;
  let position = 0;
  const peek = () => tokens[position]?.type;
  function atom(depth) {
    if (depth > 8)
      fail('かっこの入れ子は8段までです。', 'invalid_search_query');
    if (peek() === 'NOT') {
      position++;
      return { type: 'not', value: atom(depth + 1) };
    }
    if (peek() === '(') {
      position++;
      const node = or(depth + 1);
      if (peek() !== ')')
        fail('閉じかっこが足りません。', 'invalid_search_query');
      position++;
      return node;
    }
    if (peek() !== 'word')
      fail(
        'AND・OR・NOTの前後に検索語を指定してください。',
        'invalid_search_query',
      );
    return { type: 'word', value: tokens[position++].value };
  }
  function and(depth) {
    let left = atom(depth);
    while (peek() === 'AND' || ['word', 'NOT', '('].includes(peek())) {
      if (peek() === 'AND') position++;
      left = { type: 'and', left, right: atom(depth) };
    }
    return left;
  }
  function or(depth) {
    let left = and(depth);
    while (peek() === 'OR') {
      position++;
      left = { type: 'or', left, right: and(depth) };
    }
    return left;
  }
  const result = or(0);
  if (position !== tokens.length)
    fail(
      '検索式のかっこや演算子を確認してください。',
      'invalid_search_query',
    );
  return result;
}
const dateFields = {
  created: 'created_at',
  updated: 'updated_at',
  published: 'published_at',
};
function utc(year, month = 1, day = 1) {
  return new Date(
    Date.UTC(year, month - 1, day) - 9 * 3600000,
  ).toISOString();
}
function yearValue(value) {
  if (
    !/^\d{4}$/.test(value) ||
    Number(value) < 1000 ||
    Number(value) > 9998
  )
    fail('年を正しく指定してください。');
  return Number(value);
}
function dateValue(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
    fail('日付を正しく指定してください。');
  const [y, m, d] = value.split('-').map(Number);
  yearValue(String(y));
  const date = new Date(Date.UTC(y, m - 1, d));
  if (
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() + 1 !== m ||
    date.getUTCDate() !== d
  )
    fail('存在する日付を指定してください。');
  return [y, m, d];
}
export function searchPlan(params) {
  const status = params.get('status') || 'pending_review';
  if (
    !['all', 'pending_review', 'published', 'rejected'].includes(status)
  )
    fail('記事の状態を確認してください。');
  const basis = params.get('date_basis') || 'created',
    field = dateFields[basis];
  if (!field) fail('時期の基準を確認してください。');
  const sort = params.get('sort') || 'newest';
  if (!['newest', 'oldest'].includes(sort))
    fail('並び順を確認してください。');
  const scope = params.get('scope') || 'content';
  const columns = {
    content: ['title', 'excerpt', 'body_markdown', 'tags'],
    title: ['title'],
    body: ['excerpt', 'body_markdown'],
    notes: ['ai_check_notes'],
  }[scope];
  if (!columns) fail('検索対象を確認してください。');
  const conditions = [],
    values = [];
  if (status === 'all') conditions.push("a.status!='draft'");
  else {
    conditions.push('a.status=?');
    values.push(status);
  }
  if (basis === 'published')
    conditions.push('a.published_at IS NOT NULL');
  const categories = [...new Set(params.getAll('category'))];
  if (
    categories.length > 4 ||
    categories.some((v) => !['skin', 'hair', 'nail', 'body'].includes(v))
  )
    fail('部位を確認してください。');
  if (categories.length) {
    conditions.push(
      'a.category IN (' + categories.map(() => '?').join(',') + ')',
    );
    values.push(...categories);
  }
  const tags = [
    ...new Set(
      (params.getAll('tag').length
        ? params.getAll('tag')
        : (params.get('tags') || '').split(/[,、]/)
      )
        .map((v) => v.trim())
        .filter(Boolean),
    ),
  ];
  if (tags.length > 10 || tags.some((v) => v.length > 30))
    fail('タグは30文字以内、最大10個です。');
  const tagMode = params.get('tag_mode') || 'and';
  if (!['and', 'or'].includes(tagMode))
    fail('タグの条件を確認してください。');
  if (tags.length) {
    const lookups = tags.map((v) => {
      values.push(v);
      return 'a.id IN (SELECT article_id FROM article_tags WHERE tag=?)';
    });
    conditions.push(
      '(' + lookups.join(tagMode === 'or' ? ' OR ' : ' AND ') + ')',
    );
  }
  function range(start, end) {
    conditions.push('a.' + field + '>=?', 'a.' + field + '<?');
    values.push(start, end);
  }
  if (params.has('decade') || params.has('year'))
    fail('年月または開始日・終了日で指定してください。');
  if (params.get('month')) {
    const value = params.get('month');
    if (!/^\d{4}-\d{2}$/.test(value))
      fail('月を正しく指定してください。');
    const [y, m] = value.split('-').map(Number);
    yearValue(String(y));
    if (m < 1 || m > 12) fail('月を正しく指定してください。');
    range(utc(y, m), utc(y, m + 1));
  }
  const from = params.get('from'),
    to = params.get('to');
  let low, high;
  if (from) {
    low = utc(...dateValue(from));
    conditions.push('a.' + field + '>=?');
    values.push(low);
  }
  if (to) {
    const [y, m, d] = dateValue(to);
    high = utc(y, m, d + 1);
    conditions.push('a.' + field + '<?');
    values.push(high);
  }
  if (low && high && low >= high)
    fail('開始日は終了日以前にしてください。');
  function expression(node) {
    if (node.type === 'not')
      return '(NOT ' + expression(node.value) + ')';
    if (node.type === 'and' || node.type === 'or')
      return (
        '(' +
        expression(node.left) +
        (node.type === 'and' ? ' AND ' : ' OR ') +
        expression(node.right) +
        ')'
      );
    const escaped = /[%_\\]/.test(node.value);
    const pattern =
      '%' +
      (escaped
        ? node.value.replace(/[\\%_]/g, (v) => '\\' + v)
        : node.value) +
      '%';
    return (
      '(a.rowid IN (' +
      columns
        .map((column) => {
          values.push(pattern);
          return (
            'SELECT rowid FROM article_search WHERE ' +
            column +
            ' LIKE ?' +
            (escaped ? " ESCAPE '\\'" : '')
          );
        })
        .join(' UNION ') +
      '))'
    );
  }
  let ast;
  if (params.has('keyword_mode')) {
    const mode = params.get('keyword_mode');
    if (!['all', 'any'].includes(mode))
      fail('キーワードの含め方を確認してください。');
    const query = params.get('q') || '',
      excluded = params.get('exclude') || '';
    if (query.length > 500 || excluded.length > 500)
      fail('キーワードは各500文字以内です。');
    const words = query.trim().split(/\s+/).filter(Boolean),
      without = excluded.trim().split(/\s+/).filter(Boolean);
    if (words.length + without.length > 12)
      fail('検索する言葉と含めない言葉は合わせて最大12個です。');
    const join = (terms, type) =>
      terms
        .map((value) => ({ type: 'word', value }))
        .reduce(
          (left, right) => (left ? { type, left, right } : right),
          null,
        );
    ast = join(words, mode === 'any' ? 'or' : 'and');
    const negative = join(without, 'or');
    if (negative)
      ast = ast
        ? {
            type: 'and',
            left: ast,
            right: { type: 'not', value: negative },
          }
        : { type: 'not', value: negative };
  } else ast = parseExpression(params.get('q') || '');
  if (ast) conditions.push(expression(ast));
  const where = conditions.join(' AND '),
    bindings = [...values];
  const cursor = params.get('cursor');
  if (cursor) {
    if (cursor.length > 300)
      fail('続きを読み込めません。検索し直してください。');
    let decoded;
    try {
      decoded = JSON.parse(atob(cursor));
    } catch {
      fail('続きを読み込めません。検索し直してください。');
    }
    if (
      !Array.isArray(decoded) ||
      decoded.length !== 2 ||
      typeof decoded[0] !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(decoded[0]) ||
      typeof decoded[1] !== 'string' ||
      decoded[1].length > 100
    )
      fail('続きを読み込めません。検索し直してください。');
    const op = sort === 'newest' ? '<' : '>';
    conditions.push(
      '(a.' +
        field +
        op +
        '? OR (a.' +
        field +
        '=? AND a.id' +
        op +
        '?))',
    );
    values.push(decoded[0], decoded[0], decoded[1]);
  }
  return {
    where,
    bindings,
    pageWhere: conditions.join(' AND '),
    pageBindings: values,
    field,
    sort,
    hasCursor: !!cursor,
  };
}
export async function articleList(env, params) {
  const p = searchPlan(params),
    direction = p.sort === 'newest' ? 'DESC' : 'ASC';
  const rows = (
    await env.DB.prepare(
      'SELECT a.id,a.slug,a.title,a.status,a.ai_status,a.updated_at,a.created_at,a.published_at,a.revision,a.category,a.tags FROM articles a WHERE ' +
        p.pageWhere +
        ' ORDER BY a.' +
        p.field +
        ' ' +
        direction +
        ',a.id ' +
        direction +
        ' LIMIT 51',
    )
      .bind(...p.pageBindings)
      .all()
  ).results;
  const visible = rows.slice(0, 50),
    last = visible.at(-1);
  const total = p.hasCursor
    ? null
    : (
        await env.DB.prepare(
          'SELECT COUNT(*) AS total FROM articles a WHERE ' + p.where,
        )
          .bind(...p.bindings)
          .first()
      ).total;
  return {
    articles: visible.map(decode),
    total,
    next_cursor:
      rows.length > 50
        ? btoa(JSON.stringify([last[p.field], last.id]))
        : null,
    next_offset: null,
  };
}
export async function filterOptions(env) {
  const tags = (
    await env.DB.prepare(
      "SELECT DISTINCT t.tag FROM article_tags t JOIN articles a ON a.id=t.article_id WHERE a.status!='draft' ORDER BY t.tag COLLATE NOCASE",
    ).all()
  ).results.map((r) => r.tag);
  const dates = await env.DB.prepare(
    "SELECT MIN(created_at) AS first_created,MAX(created_at) AS last_created,MIN(updated_at) AS first_updated,MAX(updated_at) AS last_updated,MIN(published_at) AS first_published,MAX(published_at) AS last_published FROM articles WHERE status!='draft'",
  ).first();
  return { tags, dates, time_zone: 'Asia/Tokyo' };
}
