/**
 * Deterministic Bounded AST Expression Evaluator (No eval(), No Function())
 * Evaluates logical and relational expressions against workflow step outputs.
 */

type TokenType =
	| "IDENT"
	| "STRING"
	| "NUMBER"
	| "BOOLEAN"
	| "NULL"
	| "OP"
	| "LPAREN"
	| "RPAREN"
	| "EOF";

interface Token {
	type: TokenType;
	value: string | number | boolean | null;
}

export function tokenize(expr: string): Token[] {
	const tokens: Token[] = [];
	let i = 0;

	while (i < expr.length) {
		const c = expr[i]!;

		// Whitespace
		if (/\s/.test(c)) {
			i++;
			continue;
		}

		// Parentheses
		if (c === "(") {
			tokens.push({ type: "LPAREN", value: "(" });
			i++;
			continue;
		}
		if (c === ")") {
			tokens.push({ type: "RPAREN", value: ")" });
			i++;
			continue;
		}

		// Multi-character operators
		if (expr.startsWith("===", i)) {
			tokens.push({ type: "OP", value: "===" });
			i += 3;
			continue;
		}
		if (expr.startsWith("!==", i)) {
			tokens.push({ type: "OP", value: "!==" });
			i += 3;
			continue;
		}
		if (expr.startsWith("==", i)) {
			tokens.push({ type: "OP", value: "==" });
			i += 2;
			continue;
		}
		if (expr.startsWith("!=", i)) {
			tokens.push({ type: "OP", value: "!=" });
			i += 2;
			continue;
		}
		if (expr.startsWith(">=", i)) {
			tokens.push({ type: "OP", value: ">=" });
			i += 2;
			continue;
		}
		if (expr.startsWith("<=", i)) {
			tokens.push({ type: "OP", value: "<=" });
			i += 2;
			continue;
		}
		if (expr.startsWith("&&", i)) {
			tokens.push({ type: "OP", value: "&&" });
			i += 2;
			continue;
		}
		if (expr.startsWith("||", i)) {
			tokens.push({ type: "OP", value: "||" });
			i += 2;
			continue;
		}
		if (c === ">" || c === "<" || c === "!") {
			tokens.push({ type: "OP", value: c });
			i++;
			continue;
		}

		// Strings ('...' or "...")
		if (c === "'" || c === '"') {
			const quote = c;
			let s = "";
			i++;
			while (i < expr.length && expr[i] !== quote) {
				if (expr[i] === "\\" && i + 1 < expr.length) {
					s += expr[i + 1];
					i += 2;
				} else {
					s += expr[i];
					i++;
				}
			}
			if (i >= expr.length) throw new Error("Unterminated string literal in condition expression");
			i++; // skip closing quote
			tokens.push({ type: "STRING", value: s });
			continue;
		}

		// Numbers
		if (/\d/.test(c) || (c === "-" && i + 1 < expr.length && /\d/.test(expr[i + 1]!))) {
			let numStr = c;
			i++;
			while (i < expr.length && /[\d.]/.test(expr[i]!)) {
				numStr += expr[i];
				i++;
			}
			const num = parseFloat(numStr);
			if (isNaN(num)) throw new Error(`Invalid number literal '${numStr}'`);
			tokens.push({ type: "NUMBER", value: num });
			continue;
		}

		// Identifiers or boolean / null keywords
		if (/[a-zA-Z_$]/.test(c)) {
			let id = c;
			i++;
			while (i < expr.length && /[a-zA-Z0-9_$.]/.test(expr[i]!)) {
				id += expr[i];
				i++;
			}
			if (id === "true") {
				tokens.push({ type: "BOOLEAN", value: true });
			} else if (id === "false") {
				tokens.push({ type: "BOOLEAN", value: false });
			} else if (id === "null") {
				tokens.push({ type: "NULL", value: null });
			} else {
				tokens.push({ type: "IDENT", value: id });
			}
			continue;
		}

		throw new Error(`Unexpected character '${c}' in condition expression`);
	}

	tokens.push({ type: "EOF", value: null });
	return tokens;
}

function resolveIdentifier(path: string, context: Record<string, unknown>): unknown {
	const parts = path.split(".");
	let curr: unknown = context;
	for (const part of parts) {
		if (curr === null || curr === undefined || typeof curr !== "object") {
			return undefined;
		}
		curr = (curr as Record<string, unknown>)[part];
	}
	return curr;
}

class Parser {
	private pos = 0;
	private tokens: Token[];
	private context: Record<string, unknown>;

	constructor(tokens: Token[], context: Record<string, unknown>) {
		this.tokens = tokens;
		this.context = context;
	}

	private peek(): Token {
		return this.tokens[this.pos] || { type: "EOF", value: null };
	}

	private consume(): Token {
		const t = this.peek();
		this.pos++;
		return t;
	}

	parse(): boolean {
		const res = this.parseOr();
		if (this.peek().type !== "EOF") {
			throw new Error(`Unexpected token '${this.peek().value}' after expression`);
		}
		return Boolean(res);
	}

	private parseOr(): unknown {
		let left = this.parseAnd();
		while (this.peek().type === "OP" && this.peek().value === "||") {
			this.consume();
			const right = this.parseAnd();
			left = Boolean(left || right);
		}
		return left;
	}

	private parseAnd(): unknown {
		let left = this.parseComparison();
		while (this.peek().type === "OP" && this.peek().value === "&&") {
			this.consume();
			const right = this.parseComparison();
			left = Boolean(left && right);
		}
		return left;
	}

	private parseComparison(): unknown {
		const left = this.parseUnary();
		const opToken = this.peek();
		if (
			opToken.type === "OP" &&
			["==", "===", "!=", "!==", ">", "<", ">=", "<="].includes(String(opToken.value))
		) {
			this.consume();
			const right = this.parseUnary();
			switch (opToken.value) {
				case "==":
				case "===":
					return left === right;
				case "!=":
				case "!==":
					return left !== right;
				case ">":
					return Number(left) > Number(right);
				case "<":
					return Number(left) < Number(right);
				case ">=":
					return Number(left) >= Number(right);
				case "<=":
					return Number(left) <= Number(right);
			}
		}
		return left;
	}

	private parseUnary(): unknown {
		if (this.peek().type === "OP" && this.peek().value === "!") {
			this.consume();
			const val = this.parseUnary();
			return !val;
		}
		return this.parsePrimary();
	}

	private parsePrimary(): unknown {
		const t = this.peek();
		if (t.type === "LPAREN") {
			this.consume();
			const res = this.parseOr();
			if (this.peek().type !== "RPAREN") {
				throw new Error("Missing closing parenthesis");
			}
			this.consume();
			return res;
		}
		if (t.type === "STRING" || t.type === "NUMBER" || t.type === "BOOLEAN" || t.type === "NULL") {
			this.consume();
			return t.value;
		}
		if (t.type === "IDENT") {
			this.consume();
			return resolveIdentifier(String(t.value), this.context);
		}
		throw new Error(`Unexpected token '${t.value}' in expression`);
	}
}

export function evaluateCondition(expression: string, context: Record<string, unknown>): boolean {
	const trimmed = expression.trim();
	if (!trimmed) {
		throw new Error("Condition expression cannot be empty");
	}
	const tokens = tokenize(trimmed);
	const parser = new Parser(tokens, context);
	return parser.parse();
}
