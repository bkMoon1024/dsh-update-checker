/**
 * Tests for the markdown-lite parser inside client/client.js.
 * Loads the real module with stubbed window.__ModuleLoader__ / require('react'),
 * then asserts on the pure AST produced by parseMarkdownBody / parseInline.
 *
 * Run: node test/md.test.mjs
 */
let captured = null;
globalThis.window = { __ModuleLoader__: { load(mod) { captured = mod; } } };
await import('file:///D:/dsh%20work/dsh-update-checker/client/client.js');

if (!captured || captured.id !== 'dsh-update-checker') throw new Error('module not captured');
const reactStub = { createElement: (...args) => args, Fragment: 'Fragment' };
const plugin = captured.factory((name) => reactStub);
if (typeof plugin?.apply !== 'function') throw new Error('factory did not return a plugin object');
const { parseMarkdownBody, parseInline } = plugin._internals;

const results = [];
function check(name, condition, detail = '') {
  results.push(!!condition);
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}
const json = (value) => JSON.stringify(value);

// 1. empty / non-string inputs
check('empty string → []', json(parseMarkdownBody('')) === '[]');
check('non-string → []', json(parseMarkdownBody(null)) === '[]');

// 2. headings
check('h1 parsed', json(parseMarkdownBody('# Title')) === json([{ type: 'h', level: 1, inline: [{ t: 'txt', text: 'Title' }] }]));
check('h3 level', parseMarkdownBody('### Deep')[0].level === 3);

// 3. inline: bold, code, link, bare URL with trailing punctuation
const inline = parseInline('see **bold**, `x.y`, [docs](https://e.com/a) and https://bare.com.');
check('inline bold', json(inline.find((n) => n.t === 'b')) === json({ t: 'b', text: 'bold' }));
check('inline code', json(inline.find((n) => n.t === 'c')) === json({ t: 'c', text: 'x.y' }));
check('inline link', json(inline.find((n) => n.t === 'a' && n.text === 'docs')) === json({ t: 'a', text: 'docs', href: 'https://e.com/a' }));
const bare = inline.find((n) => n.t === 'a' && n.text.startsWith('https://bare'));
check('bare URL, trailing dot trimmed', bare?.href === 'https://bare.com' && bare?.text === 'https://bare.com', json(bare));
check('surrounding text kept', inline[0]?.text === 'see ' && inline.some((n) => n.text?.includes(', ')));

// 4. image degrades to a link node
const img = parseInline('shot ![logo](https://e.com/l.png) here');
check('image → link node', json(img.find((n) => n.t === 'a')) === json({ t: 'a', text: 'logo', href: 'https://e.com/l.png' }));

// 5. lists: consecutive bullets group, ordered lists keep kind
const md = '- a\n- b\n\n1. first\n2. second';
const blocks = parseMarkdownBody(md);
check('ul group', blocks[0]?.type === 'ul' && blocks[0].items.length === 2);
check('ol group', blocks[1]?.type === 'ol' && blocks[1].items.length === 2);
check('ol item text', blocks[1].items[0][0]?.text === 'first');

// 6. quote + hr + paragraph join
const blocks2 = parseMarkdownBody('> note line\n\n---\n\none\ntwo');
check('quote', blocks2[0]?.type === 'quote' && blocks2[0].inline.some((n) => n.text?.includes('note line')));
check('hr', blocks2[1]?.type === 'hr');
check('paragraph lines joined by space', blocks2[2]?.type === 'p' && blocks2[2].inline.some((n) => n.text === 'one two ' || n.text?.includes('one two')), json(blocks2[2]));

// 7. code fence (closed + unterminated)
const blocks3 = parseMarkdownBody('```\nconst a = 1;\nconst b = 2;\n```\nafter');
check('fence body', blocks3[0]?.type === 'code' && blocks3[0].text === 'const a = 1;\nconst b = 2;');
check('text after fence', blocks3[1]?.type === 'p');
const blocks4 = parseMarkdownBody('```\nlet x = 9;');
check('unterminated fence flushed', blocks4[0]?.type === 'code' && blocks4[0].text === 'let x = 9;');

// 8. mixed realistic release body
const release = `## What's new\n\n- faster **scan**\n- fix \`crash\` on start (#123)\n\n### Notes\n\nSee https://example.com/changelog. Thanks!`;
const blocks5 = parseMarkdownBody(release);
check('realistic: h2 first', blocks5[0]?.type === 'h' && blocks5[0].level === 2);
check('realistic: ul with inline', blocks5[1]?.type === 'ul' && blocks5[1].items[0].some((n) => n.t === 'b'));
check('realistic: h3 + paragraph', blocks5[2]?.type === 'h' && blocks5[3]?.type === 'p' && blocks5[3].inline.some((n) => n.t === 'a'));

// 9. list interrupting paragraph starts a new list kind correctly
const blocks6 = parseMarkdownBody('* one\n1. uno');
check('kind switch splits list', blocks6[0]?.type === 'ul' && blocks6[1]?.type === 'ol');

const failed = results.filter((pass) => !pass).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
