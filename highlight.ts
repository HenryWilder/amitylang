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

type ScopeType = 'subexpression' | 'statement or object' | 'array' | 'keyword' | 'global';

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
    scope?: Scope[];
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
    const currentScope = (): Scope | undefined => scopeStack[scopeStack.length - 1];
    const scopeDebug: Scope[][] = [];
    const pushScope = (type: ScopeType, context?: Keyword) => {
        console.log(`{ type: '${type}', context: '${context}' }`);
        scopeStack.push({ type: type, context: context });
        console.debug([...scopeStack]);
        scopeDebug.push([...scopeStack]);
    };
    const popScope = () => {
        scopeStack.pop();
    };
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
                pushScope(scopeTypes[text], mostRecentKeyword);
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
                    popScope();
                }
            }
        }
        // Control keywords
        else if (isControlKeyword(text)) {
            mostRecentKeyword = text;
            if (currentScope()?.type === 'keyword') {
                popScope();
            }
            if (text === 'define' || text === 'import') {
                pushScope('keyword', text);
            }
            ast.body.push({ type: 'control', text, range });
        }
        // Keywords
        else if (isRegularKeyword(text)) {
            mostRecentKeyword = text;
            if (currentScope()?.type === 'keyword') {
                popScope();
            }
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
            ast.body.push({ type: 'semantic', scope: scopeStack, text, range });
        }
        // All others
        else {
            ast.body.push({ type: 'unknown', text, range });
        }
        console.debug(ast.body[ast.body.length - 1]);
    }

    console.debug(scopeDebug.map((record) => record.map((scope) => `${scope.context} (${scope.type})`).join(' > ')).join('\n'));
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
            if (item.scope === undefined) throw new Error('All semantics must have scope');
            const scope: Scope[] = item.scope;
            const topScope: Scope = scope[scope.length - 1] ?? { type: 'global' };

            // Being defined/declared
            if (scope.some((x) => ['define', 'import'].includes(x.context ?? ''))) {
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

                    case 'adjective':
                        createSemantic(item.text, { type: 'adjective', id });
                        break;
                }
                console.debug(semantics);
            } else if (topScope.type === 'subexpression' && topScope.context === 'import') {
                createSemantic(item.text, { type: 'object', id });
            }

            const semantic = findSemantic(item.text);
            console.debug(semantic);

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
    const bracket = (item: Symbol) => `b${item.depth}`;
    const classNameMap: { [type: string]: string | ((item: Symbol) => string) } = {
        illegal: 'illegal',
        comment: 'c',
        paren: bracket,
        bracket: bracket,
        brace: bracket,
        control: 'kc',
        keyword: 'k',
        string: 'str',
        adjective: 'adj',
        property: 'o',
        object: 'o',
        number: 'num',
        verb: 'v',
        noun: 'n',
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
