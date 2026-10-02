/**
 * Server-side classification for queries that do not need a fresh web search.
 *
 * This includes true greetings plus short, context-dependent transformation
 * requests such as "Give me notes of it" or "Explain the second one". Those
 * follow-ups should be answered from the active conversation rather than using
 * the literal pronoun-heavy text as a new web-search query.
 */

const GREETING_PATTERNS: ReadonlyArray<RegExp> = [
	/^(hi|hello|hey|howdy)(\s+there)?[!.,\s]*$/i,
	/^(thanks|thank you|thx|ty)[!.,\s]*$/i,
	/^(bye|goodbye|see you|cya)[!.,\s]*$/i,
	/^good (morning|afternoon|evening|night)[!.,\s]*$/i,
	/^(gm|gn)\b[!.,\s]*$/i,
	/^(ok|okay|k|cool|nice|great)[!.,\s]*$/i,
	/^how are you\??[!.,\s]*$/i,
	/^what'?s up\??[!.,\s]*$/i,
	/^sup\??[!.,\s]*$/i,
];

const EXPLICIT_WEB_INTENT_RE =
	/\b(search|research|look\s*up|browse|web|online|sources?|evidence|verify|fact-?check|latest|current|today|news|recent|up[- ]?to[- ]?date|updated)\b/i;

/**
 * Short requests whose meaning is primarily inherited from the active thread.
 * Keep these conservative and anchored so a standalone question such as
 * "What is Bitcoin and how does it work?" still uses the normal grounded path.
 */
const CONTEXT_ONLY_FOLLOW_UP_PATTERNS: ReadonlyArray<RegExp> = [
	/^(?:give|create|make)\s+(?:me\s+)?(?:\d+\s+)?(?:notes?|a summary|summary|bullet points?|bullets?|mcqs?|questions?|a quiz|quiz|flashcards?)(?:\s+(?:of|from|about|on)\s+(?:it|this|that|these|those|them|the above|the previous answer|your answer))?[.!?\s]*$/i,
	/^(?:make|shorten|expand|simplify|summari[sz]e|rewrite|rephrase|convert|turn|translate)\s+(?:it|this|that|these|those|them|the above|the previous answer|your answer)(?:\s+.*)?$/i,
	/^explain\s+(?:it|this|that|these|those|them|the\s+(?:first|second|third|fourth|fifth)\s+(?:one|point|item|example|option))(?:\s+.*)?$/i,
	/^(?:what|which)\s+(?:about|of)\s+(?:it|this|that|these|those|them)\??[.!?\s]*$/i,
	/^what\s+(?:are|is)\s+(?:its|their)\b.*$/i,
	/^which\s+(?:one|option)\b.*$/i,
	/^tell\s+me\s+more(?:\s+about\s+(?:it|this|that|these|those|them))?[.!?\s]*$/i,
	/^compare\s+(?:them|these|those)(?:\s+.*)?$/i,
	/^(?:why|how so|continue|go on|more|more details|elaborate)[.!?\s]*$/i,
];

function normalizeOneLine(q: string): string {
	return q.trim().replace(/\s+/g, " ");
}

export function isContextOnlyFollowUpQuery(raw: string): boolean {
	const t = normalizeOneLine(raw);
	if (t.length === 0 || t.length > 240) return false;
	if (raw.includes("\n")) return false;
	if (EXPLICIT_WEB_INTENT_RE.test(t)) return false;
	return CONTEXT_ONLY_FOLLOW_UP_PATTERNS.some((r) => r.test(t));
}

export function isGreetingOnlyQuery(raw: string): boolean {
	const t = normalizeOneLine(raw);
	if (t.length === 0) return false;
	if (raw.includes("\n")) return false;
	const greeting = t.length <= 80 && GREETING_PATTERNS.some((r) => r.test(t));
	return greeting || isContextOnlyFollowUpQuery(raw);
}

/**
 * Accepts optional `/calc ` prefix or leading `=`, then a numeric expression
 * using digits, decimal points, parentheses, and + - * / only.
 * Returns a display string for the result, or null if not a pure math query.
 */
export function tryParseMathAnswer(raw: string): string | null {
	let s = raw.trim();
	s = s.replace(/^\/calc\s+/i, "");
	s = s.replace(/^=\s*/, "");
	if (!s) return null;
	if (s.length > 200) return null;
	if (!/^[\d+\-*/().\s]+$/.test(s)) return null;
	const compact = s.replace(/\s/g, "");
	if (!compact) return null;
	let depth = 0;
	for (const c of compact) {
		if (c === "(") depth++;
		else if (c === ")") {
			depth--;
			if (depth < 0) return null;
		}
	}
	if (depth !== 0) return null;

	const result = evaluateArithmeticExpression(compact);
	if (result === null || !Number.isFinite(result)) return null;
	if (Number.isInteger(result)) return String(result);
	const rounded = Math.round(result * 1e12) / 1e12;
	return String(rounded);
}

/** Whitespace-free expression: digits, `.`, `+`, `-`, `*`, `/`, parentheses. */
function evaluateArithmeticExpression(expr: string): number | null {
	let i = 0;

	function peek(): string | undefined {
		return expr[i];
	}

	function eat(ch: string): boolean {
		if (peek() === ch) {
			i++;
			return true;
		}
		return false;
	}

	function parseNumber(): number | null {
		const start = i;
		let sawDot = false;
		while (i < expr.length) {
			const c = expr[i]!;
			if (c === ".") {
				if (sawDot) return null;
				sawDot = true;
				i++;
				continue;
			}
			if (c >= "0" && c <= "9") {
				i++;
				continue;
			}
			break;
		}
		if (start === i) return null;
		const slice = expr.slice(start, i);
		if (slice === "." || slice.endsWith(".")) return null;
		const n = Number(slice);
		return Number.isFinite(n) ? n : null;
	}

	function parseFactor(): number | null {
		if (eat("(")) {
			const inner = parseExpr();
			if (inner === null || !eat(")")) return null;
			return inner;
		}
		if (eat("-")) {
			const f = parseFactor();
			return f === null ? null : -f;
		}
		if (eat("+")) {
			return parseFactor();
		}
		return parseNumber();
	}

	function parseTerm(): number | null {
		let left = parseFactor();
		if (left === null) return null;
		for (;;) {
			if (eat("*")) {
				const r = parseFactor();
				if (r === null) return null;
				left *= r;
			} else if (eat("/")) {
				const r = parseFactor();
				if (r === null || r === 0) return null;
				left /= r;
			} else {
				break;
			}
		}
		return left;
	}

	function parseExpr(): number | null {
		let left = parseTerm();
		if (left === null) return null;
		for (;;) {
			if (eat("+")) {
				const r = parseTerm();
				if (r === null) return null;
				left += r;
			} else if (eat("-")) {
				const r = parseTerm();
				if (r === null) return null;
				left -= r;
			} else {
				break;
			}
		}
		return left;
	}

	const v = parseExpr();
	if (v === null || i !== expr.length) return null;
	return v;
}
