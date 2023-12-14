'use strict';

/**
 * @param {string} codeStr
 * @returns {string}
 */
const sanitize = (codeStr) => {
    const rules = [
        { pat: /</g, sub: '&lt;' },
        { pat: />/g, sub: '&gt;' },
        { pat: /\$~lt\$/g, sub: '<' },
        { pat: /\$~gt\$/g, sub: '>' },
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
 * @typedef {{ type: 'subexpression'|'statement or object'|'array', context: string }} Scope
 * @typedef { Token & { scope: Scope } } Symbol
 * @typedef {{ type: 'program', body: Symbol[] }} AST Abstract syntax tree
 */

/**
 * @param {string} code
 * @returns {Token[]}
 */
const tokenize = (code) => {
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

    // console.debug(tokens);
    return tokens;
};

/**
 * @param {Token[]} tokens
 * @returns {AST}
 */
const parse = (tokens) => {
    const ast = { type: 'program', body: [] };
    let mostRecentKeyword;
    /** @type {Scope[]} */
    const scopeStack = [];
    const currentScope = () => scopeStack[scopeStack.length - 1];
    let depth = 0;
    for (let i = 0; i < tokens.length; ++i) {
        let token = tokens[i];
        const { range, text } = token;

        // Block comments
        if (text.startsWith('//') || (text.startsWith('/*') && text.endsWith('*/'))) {
            ast.body.push({ type: 'comment', range });
        }
        // Brackets
        else if ('({[]})'.includes(text)) {
            if ('({['.includes(text)) {
                ++depth;
                const scopeTypes = {
                    '(': 'subexpression',
                    '{': 'statement or object',
                    '[': 'array',
                };
                scopeStack.push({ type: scopeTypes[text], context: mostRecentKeyword });
            }

            let type;
            const bracketTypes = {
                '()': 'paren',
                '[]': 'bracket',
                '{}': 'brace',
            };

            for (const key in bracketTypes) {
                if (key.includes(text)) {
                    type = bracketTypes[key];
                    break;
                }
            }

            ast.body.push({ type, depth, text, range });

            if (']})'.includes(text)) {
                if (depth === 0) {
                    ast.body[ast.body.length - 1].type = 'illegal';
                } else {
                    --depth;
                    scopeStack.pop();
                }
            }
        }
        // Control keywords
        else if (text.match(/^(import|from|define|as|for|if|await|then|with)$/)) {
            mostRecentKeyword = text;
            ast.body.push({ type: 'control', definesSemantic: text.match(/import|define/), text, range });
        }
        // Keywords
        else if (text.match(/^(noun|verb|adjective|shorthand|or|is|undefined|null|true|false)$/)) {
            mostRecentKeyword = text;
            ast.body.push({ type: 'keyword', text, range });
        }
        // String literals
        else if (text.match(/^('.*'|".*")$/)) {
            ast.body.push({ type: 'string', text, range });
        }
        // Number literals
        else if (text.match(/^\d+(?:\.\d+)?$/)) {
            ast.body.push({ type: 'number', text, range });
        }
        // Properties
        else if (currentScope() === 'statement or object' && tokens[i + 1].text === ':') {
            ast.body.push({ type: 'property', text, range });
        }
        // Symbols
        else if (text.match(/^[A-Za-z_][A-Za-z_0-9]*$/)) {
            ast.body.push({ type: 'semantic', scope: currentScope(), text, range });
        }
        // All others
        else {
            ast.body.push({ type: 'unknown', text, range });
        }
    }

    // console.debug(ast);
    return ast;
};

/**
 * @param {AST} ast
 * @returns {AST}
 */
const analyze = (ast) => {
    /**
     * Stack
     * @type {{[symbol: string]: { type: 'object'|'noun'|'verb'|'adjective'|'shorthand', id: number }}[]}
     */
    const semantics = [];
    let id = 0;

    for (const item of ast.body) {
        if (item.type === 'semantic') {
            const isNewSemantic = item.scope === 'statement or object';

            // Being defined/declared
            if (isNewSemantic) {
                semantics.push({ type: 'object', id });
            }

            // Already defined
            if (item.text in semantics) {
                item.type = semantics[item.text].type;
            }
            // Undefined
            else {
                item.type = 'illegal';
            }
        }
    }

    return ast;
};

/**
 * @param {string} original
 * @param {AST} ast
 * @returns {string} Syntax-highlighted string
 */
const highlight = (original, ast) => {
    const classNameMap = {
        illegal: 'illegal',
        comment: 'c',
        paren: (item) => `b${item.depth}`,
        bracket: (item) => `b${item.depth}`,
        brace: (item) => `b${item.depth}`,
        control: 'kc',
        keyword: 'k',
        string: 's',
        property: 'o',
        object: 'o',
        number: 'n',
        function: 'f',
        type: 't',
        operator: 'op',
        punctuation: 'p',
    };

    let highlighted = '';
    for (const item of ast.body) {
        const className = classNameMap[item.type] ?? '';
        const start = item.range.start;
        const end = start + item.range.size;
        const substring = original.substring(start, end);
        highlighted += `$~lt$span class="${typeof className === 'function' ? className(item) : className}"$~gt$${substring}$~lt$/span$~gt$`;
    }
    return highlighted;
};

/**
 * @param {string} code
 * @returns {string}
 */
export const compileToHighlighted = (code) => {
    return sanitize(highlight(code, analyze(parse(tokenize(code)))));
};
