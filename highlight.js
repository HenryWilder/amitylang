/**
 * @type {string}
 */
const exampleCode = await (await fetch('./example.amy')).text();

export const sanitize = (codeStr) => {
    const rules = [
        { pat: /</g, sub: '&lt;' },
        { pat: />/g, sub: '&gt;' },
    ];
    let sanitized = codeStr;
    for (const rule of rules) {
        sanitized = sanitized.replace(rule.pat, rule.sub);
    }
    return sanitized;
};

/**
 * @typedef {{ start: number, size: number }} Range
 * @typedef {{ text: string, range: Range }} Token
 * @typedef {{ type: 'program', body: any[] }} AST Abstract syntax tree
 */

/**
 * @param {string} code
 * @returns {Token[]}
 */
export const tokenize = (code) => {
    const rx = /\s*(\/\*[\s\S]+?\*\/|\/\/.*|=>|[<=>~!+\-*\/%&\|^]=|\*\*|{|}|\(|\)|\[|\]|".*"|'.*'|[A-Za-z_][A-Za-z_0-9]*|\d+(?:\.\d+)?|\S)\s*/g;
    let result;
    const tokens = [];
    while ((result = rx.exec(code)) !== null) {
        const text = result[1];
        const range = {
            start: result.index,
            size: result[0].length,
        };
        tokens.push({ text, range });
    }

    console.debug(tokens);
    return tokens;
};

/**
 * @param {Token[]} tokens
 * @returns {AST}
 */
export const parse = (tokens) => {
    const ast = { type: 'program', body: [] };
    let scopeStack = [];
    const currentScope = () => scopeStack[scopeStack.length - 1];
    let depth = 0;
    for (let i = 0; i < tokens.length; ++i) {
        let token = tokens[i];
        const range = token.range;

        // Block comments
        if (token.text.startsWith('//') || (token.text.startsWith('/*') && token.text.endsWith('*/'))) {
            ast.body.push({ type: 'comment', range });
        }
        // Brackets
        else if ('({[]})'.includes(token.text)) {
            let bracketDepth;
            if ('({['.includes(token.text)) {
                bracketDepth = ++depth;
                const scopeTypes = {
                    '(': 'subexpression',
                    '{': 'statement or object',
                    '[': 'array',
                };
                scopeStack.push(scopeTypes[token.text]);
            } else {
                bracketDepth = depth--;
                scopeStack.pop();
            }

            let type;
            const bracketTypes = {
                '()': 'paren',
                '[]': 'bracket',
                '{}': 'brace',
            };

            for (const key in bracketTypes) {
                if (key.includes(token.text)) {
                    type = bracketTypes[key];
                    break;
                }
            }

            ast.body.push({ type, depth: bracketDepth, range });
        }
        // Control keywords
        else if (token.text.match(/^(import|from|define|as|for|if|await|then|with)$/)) {
            ast.body.push({ type: 'control', range });
        }
        // Keywords
        else if (token.text.match(/^(noun|verb|adjective|shorthand|or|is)$/)) {
            ast.body.push({ type: 'keyword', range });
        }
        // String literals
        else if (token.text.match(/^('.*'|".*")$/)) {
            ast.body.push({ type: 'string', range });
        }
        // Number literals
        else if (token.text.match(/^\d+(?:\.\d+)?$/)) {
            ast.body.push({ type: 'number', range });
        }
        // Properties
        else if (currentScope() === 'statement or object' && (token.text === ':' || tokens[i + 1].text === ':')) {
            ast.body.push({ type: 'property', range });
        }
        // All others
        else {
            ast.body.push({ type: 'unknown', range });
        }
    }
    console.debug(ast);
    return ast;
};

/**
 * @param {string} original
 * @param {AST} ast
 * @returns {string} Syntax-highlighted string
 */
export const highlight = (original, ast) => {
    let highlighted = '';
    for (const item of ast.body) {
        let className;
        switch (item.type) {
            case 'illegal':
                className = 'illegal';
                break;

            case 'comment':
                className = 'c';
                break;

            case 'paren':
            case 'bracket':
            case 'brace':
                className = 'b' + item.depth;
                break;

            case 'control':
                className = 'kc';
                break;

            case 'keyword':
                className = 'k';
                break;

            case 'string':
                className = 's';
                break;

            case 'property':
                className = 'o';
                break;

            case 'number':
                className = 'n';
                break;

            default:
                className = '';
                break;
        }
        highlighted += `<span class="${className}">${original.substring(item.range.start, item.range.start + item.range.size)}</span>`;
    }
    return highlighted;
};

const code = sanitize(exampleCode);
document.getElementById('code').innerHTML = highlight(code, parse(tokenize(code)));
