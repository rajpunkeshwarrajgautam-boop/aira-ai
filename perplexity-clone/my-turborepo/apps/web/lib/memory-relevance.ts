const STOP_WORDS = new Set(
	"the and for that this with from about what which where who when how are was were have has had you your yours user users user's me my our ours only answer exact actually remember remembered know asked told previously please would could should can if otherwise say do does not don't it its into use using".split(" "),
);

export function memoryQueryTokens(value: string): string[] {
	return [...new Set(value.toLowerCase().normalize("NFKC")
		.replace(/[^\p{L}\p{N}._-]+/gu, " ").split(/\s+/)
		.filter((token) => token.length > 2 && !STOP_WORDS.has(token)))].slice(0, 40);
}

/** An inventory request must not turn a topic-specific recall into all memories. */
export function isMemoryInventoryQuery(query: string): boolean {
	return /^(?:(?:please\s+)?(?:what do you (?:remember|know) about me|what do you remember|(?:show|list)(?: me)?(?: all)?(?: of)? my (?:memories|preferences|profile)|my (?:memories|preferences|profile)))\s*[?!.]*$/i.test(query.trim());
}

export function requestedMemorySubjects(query: string): string[] {
	return [...query.matchAll(/\b(?:(?:what|which|where|who)\s+(?:is|are|was|were)|what do you (?:remember|know) about)\s+(?:my|our)\s+([^?!.\n]+)/gi)]
		.map((match) => match[1]?.split(/\s+(?:that|which)\s+(?:I|we)\b|\s+(?:answer|respond|reply)\b/i)[0]?.trim() ?? "")
		.filter(Boolean);
}

export function isPersonalMemoryRecallQuery(query: string): boolean {
	return isMemoryInventoryQuery(query) || requestedMemorySubjects(query).length > 0 ||
		/\b(?:do you remember|what (?:did|have) I (?:tell|told|ask|asked)|I asked you to remember)\b/i.test(query);
}

/** Keep distinguishing qualifiers: a private code is not a certification code. */
export function memoryMatchesRequestedSubject(content: string, query: string): boolean {
	const subjects = requestedMemorySubjects(query);
	if (subjects.length === 0) return true;
	const storedSubject = content.match(/^(.{3,160}?)\s+(?:is|are|should be|defaults? to|=)\s+/i)?.[1] ?? content;
	const stored = new Set(memoryQueryTokens(storedSubject));
	return subjects.some((subject) => {
		const requested = memoryQueryTokens(subject);
		return requested.length > 0 && requested.every((token) => stored.has(token));
	});
}

export function hasMemoryTopicOverlap(content: string, keywords: readonly string[], query: string): boolean {
	const stored = new Set(memoryQueryTokens([content, ...keywords].join(" ")));
	return memoryQueryTokens(query).some((token) => stored.has(token));
}
