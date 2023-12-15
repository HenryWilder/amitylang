const sanitize = (codeStr: string): string => {
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

interface Range {
    start: number;
    size: number;
}

interface Token {
    text: string;
    range: Range;
}

const tokenize = (code: string): Token[] => {
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

const semanticDefiningKeywords = ['import', 'define'] as const;
const controlKeywords = [...semanticDefiningKeywords, 'from', 'as', 'for', 'if', 'await', 'then', 'with'] as const;
type ControlKeyword = (typeof keywords)[number];
const isControlKeyword = (x: string): x is ControlKeyword => (controlKeywords as unknown as string[]).includes(x);

const regularKeywords = ['noun', 'verb', 'adjective', 'shorthand', 'or', 'is', 'undefined', 'null', 'true', 'false'] as const;
type RegularKeyword = (typeof keywords)[number];
const isRegularKeyword = (x: string): x is RegularKeyword => (regularKeywords as unknown as string[]).includes(x);

const keywords = [...controlKeywords, ...regularKeywords] as const;
type Keyword = ControlKeyword | RegularKeyword;
const isKeyword = (x: string): x is Keyword => (keywords as unknown as string[]).includes(x);

type ScopeType = 'subexpression' | 'statement or object' | 'array';

interface Scope {
    type: ScopeType;
    context?: Keyword;
}

type SemanticType = 'object' | 'noun' | 'verb' | 'adjective' | 'shorthand';

type TokenType =
    | `${'opening' | 'closing'} ${'paren' | 'bracket' | 'brace'}`
    | 'illegal'
    | 'control'
    | 'keyword'
    | 'comment'
    | 'semantic'
    | SemanticType
    | 'number'
    | 'string'
    | 'property'
    | 'operator'
    | 'unknown';

interface Symbol extends Token {
    type: TokenType;
    scope?: Scope;
    depth?: number;
    definesSemantic?: boolean;
}

/** Abstract syntax tree */
interface AST {
    type: 'program';
    body: Symbol[];
}

const parse = (tokens: Token[]): AST => {
    const ast: AST = { type: 'program', body: [] };
    let mostRecentKeyword: Keyword | undefined;
    const scopeStack: Scope[] = [];
    const currentScope = () => scopeStack[scopeStack.length - 1];
    let depth = 0;
    for (let i = 0; i < tokens.length; ++i) {
        let token = tokens[i];
        const { range, text } = token;

        // Block comments
        if (text.startsWith('//') || (text.startsWith('/*') && text.endsWith('*/'))) {
            ast.body.push({ type: 'comment', ...token });
        }
        // Brackets
        else if ('({[]})'.includes(text)) {
            let type: string | undefined;

            if ('({['.includes(text)) {
                type = 'opening ';
                ++depth;
                const scopeTypes: { [key: string]: ScopeType } = {
                    '(': 'subexpression',
                    '{': 'statement or object',
                    '[': 'array',
                };
                scopeStack.push({ type: scopeTypes[text], context: mostRecentKeyword });
            } else {
                type = 'closing ';
            }

            const bracketTypes: { [key: string]: string } = {
                '()': 'paren',
                '[]': 'bracket',
                '{}': 'brace',
            };

            for (const key in bracketTypes) {
                if (key.includes(text)) {
                    type += bracketTypes[key];
                    break;
                }
            }

            ast.body.push({ type: type as TokenType, depth, ...token });

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
        else if (isControlKeyword(text)) {
            mostRecentKeyword = text;
            ast.body.push({ type: 'control', text, range });
        }
        // Keywords
        else if (isRegularKeyword(text)) {
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
        else if (currentScope()?.type === 'statement or object' && tokens[i + 1].text === ':') {
            ast.body.push({ type: 'property', text, range });
        }
        // Semantics
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

interface SemanticData {
    type: SemanticType;
    id: number;
}

const analyze = (ast: AST): AST => {
    const semantics: { [symbol: string]: SemanticData }[] = [{}];

    let mostRecentKeyword: Keyword | undefined;

    const createSemantic = (name: string, data: SemanticData) => {
        semantics[semantics.length - 1][name] = data;
    };

    const findSemantic = (name: string): SemanticData | undefined => {
        for (let i = semantics.length - 1; i >= 0; i--) {
            const scope = semantics[i];
            if (name in scope) {
                return scope[name];
            }
        }
    };

    let id = 0;

    for (const item of ast.body) {
        if (item.type === 'semantic') {
            // Being defined/declared
            if (item.scope?.context !== undefined && item.scope?.type === 'statement or object') {
                switch (mostRecentKeyword) {
                    case 'define':
                    case 'import':
                        createSemantic(item.text, { type: 'object', id });
                        break;

                    case 'noun':
                        createSemantic(item.text, { type: 'noun', id });
                        break;

                    case 'verb':
                        createSemantic(item.text, { type: 'verb', id });
                        break;
                }
            }

            const semantic = findSemantic(item.text);

            // Already defined
            if (semantic !== undefined) {
                item.type = semantic.type as TokenType;
            }
            // Undefined
            else {
                item.type = 'illegal';
            }
        } else if (item.type === 'keyword' || item.type === 'control') {
            mostRecentKeyword = item.text as Keyword;
        }
        // todo: push/pop scope
    }

    return ast;
};

/**
 * @returns Syntax-highlighted string
 */
const highlight = (original: string, ast: AST): string => {
    const classNameMap: { [type: string]: string | ((item: Symbol) => string) } = {
        illegal: 'illegal',
        comment: 'c',
        paren: (item: Symbol) => `b${item.depth}`,
        bracket: (item: Symbol) => `b${item.depth}`,
        brace: (item: Symbol) => `b${item.depth}`,
        control: 'kc',
        keyword: 'k',
        string: 's',
        property: 'o',
        object: 'o',
        number: 'n',
        verb: 'f',
        noun: 't',
        operator: 'op',
        punctuation: 'p',
    };

    let highlighted = '';
    for (const item of ast.body) {
        const className = classNameMap[item.type.replace(/(opening|closing) /, '')] ?? '';
        const start = item.range.start;
        const end = start + item.range.size;
        const substring = original.substring(start, end);
        highlighted += `$~lt$span class="${typeof className === 'function' ? className(item) : className}"$~gt$${substring}$~lt$/span$~gt$`;
    }
    return highlighted;
};

export const compileToHighlighted = (code: string): string => {
    return sanitize(highlight(code, analyze(parse(tokenize(code)))));
};
