import assert from 'node:assert/strict';
import { createManualMemory, listUserMemories, setUserMemoryPinned, deleteUserMemory } from '../../perplexity-clone/my-turborepo/apps/web/lib/persistent-memory-core.ts';
import { createConversation, listConversations, listConversationMessages, persistConversationTurn } from '../../perplexity-clone/my-turborepo/apps/web/lib/conversation-memory-core.ts';
import { prisma } from '../../perplexity-clone/my-turborepo/apps/web/lib/prisma.ts';
try {
  const memory = await createManualMemory({ userId: 'aira-fixture-user', content: 'Prefer concise research summaries', kind: 'PREFERENCE', pinned: true });
  assert.equal((await listUserMemories('aira-fixture-user')).length, 1);
  assert.equal(await setUserMemoryPinned('another-user', memory.id, false), false);
  assert.equal(await setUserMemoryPinned('aira-fixture-user', memory.id, false), true);
  assert.equal(await deleteUserMemory('another-user', memory.id), false);
  assert.equal(await deleteUserMemory('aira-fixture-user', memory.id), true);
  assert.equal((await listUserMemories('aira-fixture-user')).length, 0);
  const thread = await createConversation('aira-fixture-user', 'Research topic');
  const citations = [{ index: 1, url: 'https://example.org/source', title: 'Fixture source', publishedDate: null, rankingScore: 1 }];
  await persistConversationTurn({ userId: 'aira-fixture-user', conversationId: thread.id, query: 'Research topic', answer: 'Fixture answer [1]', citations, privateSession: true });
  assert.equal((await listConversations('aira-fixture-user')).length, 1);
  assert.equal((await listConversations('another-user')).length, 0);
  const messages = await listConversationMessages('aira-fixture-user', thread.id);
  assert.equal(messages.length, 2);
  assert.deepEqual(messages[1].citations, citations);
  await assert.rejects(() => listConversationMessages('another-user', thread.id));
  console.log('PASS: isolated Prisma memory create/list/ownership/unpin/delete and conversation/citation persistence');
} finally {
  await prisma.$disconnect();
}
