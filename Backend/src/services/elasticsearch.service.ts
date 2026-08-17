import { Client } from "@elastic/elasticsearch";
import { prisma } from "../libs/prisma";

const INDEX_NAME = process.env.ELASTICSEARCH_DECK_INDEX ?? "public_flashcard_decks_v1";
const BATCH_SIZE = 500;

export interface PublicDeckDocument {
  id: string;
  title: string;
  description: string | null;
  userId: string;
  authorName: string;
  cardCount: number;
  isPublic: boolean;
  updatedAt: string;
}

const clientOptions: ConstructorParameters<typeof Client>[0] = {
  node: process.env.ELASTICSEARCH_URL ?? "http://localhost:9200",
};

if (process.env.ELASTICSEARCH_API_KEY) {
  clientOptions.auth = { apiKey: process.env.ELASTICSEARCH_API_KEY };
} else if (process.env.ELASTICSEARCH_USERNAME && process.env.ELASTICSEARCH_PASSWORD) {
  clientOptions.auth = {
    username: process.env.ELASTICSEARCH_USERNAME,
    password: process.env.ELASTICSEARCH_PASSWORD,
  };
}

const client = new Client(clientOptions);
let ensureIndexPromise: Promise<void> | null = null;

async function ensureIndex() {
  if (ensureIndexPromise) return ensureIndexPromise;
  ensureIndexPromise = (async () => {
    const exists = await client.indices.exists({ index: INDEX_NAME });
    if (exists) return;
    await client.indices.create({
      index: INDEX_NAME,
      settings: {
        index: { max_ngram_diff: 19 },
        analysis: {
          tokenizer: {
            deck_title_ngram: {
              type: "ngram",
              min_gram: 1,
              max_gram: 20,
              token_chars: ["letter", "digit"],
            },
          },
          filter: {
            deck_ascii_folding: {
              type: "asciifolding",
              preserve_original: false,
            },
          },
          analyzer: {
            deck_title_index: {
              type: "custom",
              tokenizer: "deck_title_ngram",
              filter: ["lowercase", "deck_ascii_folding"],
            },
            deck_title_search: {
              type: "custom",
              tokenizer: "standard",
              filter: ["lowercase", "deck_ascii_folding"],
            },
          },
        },
      },
      mappings: {
        dynamic: "strict",
        properties: {
          id: { type: "keyword" },
          title: {
            type: "text",
            analyzer: "deck_title_index",
            search_analyzer: "deck_title_search",
          },
          description: { type: "text" },
          userId: { type: "keyword" },
          authorName: { type: "keyword" },
          cardCount: { type: "integer" },
          isPublic: { type: "boolean" },
          updatedAt: { type: "date" },
        },
      },
    });
  })().catch((error) => {
    ensureIndexPromise = null;
    throw error;
  });
  return ensureIndexPromise;
}

async function buildDocuments(decks: Array<{
  id: string;
  userId: string;
  title: string;
  description: string | null;
  isPublic: boolean;
  updatedAt: Date;
  _count: { cards: number };
}>) {
  const authorIds = [...new Set(decks.map((deck) => deck.userId))];
  const authors = authorIds.length > 0
    ? await prisma.user.findMany({
        where: { id: { in: authorIds } },
        select: { id: true, name: true },
      })
    : [];
  const authorById = new Map(authors.map((author) => [author.id, author.name]));
  return decks.map((deck): PublicDeckDocument => ({
    id: deck.id,
    title: deck.title,
    description: deck.description,
    userId: deck.userId,
    authorName: authorById.get(deck.userId) ?? "Unknown author",
    cardCount: deck._count.cards,
    isPublic: deck.isPublic,
    updatedAt: deck.updatedAt.toISOString(),
  }));
}

export const elasticsearchService = {
  async searchPublicDecks(keyword: string, page: number, limit: number) {
    await ensureIndex();
    const response = await client.search<PublicDeckDocument>({
      index: INDEX_NAME,
      from: (page - 1) * limit,
      size: limit,
      track_total_hits: true,
      query: {
        bool: {
          filter: [{ term: { isPublic: true } }],
          must: [{ match: { title: { query: keyword, operator: "and" } } }],
        },
      },
      sort: [{ _score: { order: "desc" } }, { updatedAt: { order: "desc" } }],
    });
    const total = typeof response.hits.total === "number"
      ? response.hits.total
      : response.hits.total?.value ?? 0;
    return {
      decks: response.hits.hits.flatMap((hit) => hit._source ? [hit._source] : []),
      total,
    };
  },

  async syncDeck(deckId: string) {
    await ensureIndex();
    const deck = await prisma.flashcardSet.findUnique({
      where: { id: deckId },
      select: {
        id: true, userId: true, title: true, description: true,
        isPublic: true, updatedAt: true, _count: { select: { cards: true } },
      },
    });
    if (!deck?.isPublic) {
      await client.delete({ index: INDEX_NAME, id: deckId }, { ignore: [404] });
      return;
    }
    const [document] = await buildDocuments([deck]);
    if (document) await client.index({ index: INDEX_NAME, id: deckId, document });
  },

  async syncDecksByUser(userId: string) {
    const decks = await prisma.flashcardSet.findMany({ where: { userId }, select: { id: true } });
    await Promise.all(decks.map((deck) => this.syncDeck(deck.id)));
  },

  async reindexPublicDecks() {
    await ensureIndex();
    await client.deleteByQuery({
      index: INDEX_NAME,
      conflicts: "proceed",
      query: { match_all: {} },
      refresh: true,
    });

    let cursor: string | undefined;
    let indexed = 0;
    do {
      const decks = await prisma.flashcardSet.findMany({
        where: { isPublic: true },
        orderBy: { id: "asc" },
        take: BATCH_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: {
          id: true, userId: true, title: true, description: true,
          isPublic: true, updatedAt: true, _count: { select: { cards: true } },
        },
      });
      if (decks.length === 0) break;
      const documents = await buildDocuments(decks);
      const operations = documents.flatMap((document) => [
        { index: { _index: INDEX_NAME, _id: document.id } },
        document,
      ]);
      const response = await client.bulk({ operations, refresh: false });
      if (response.errors) throw new Error("Elasticsearch bulk reindex contained failed items");
      indexed += documents.length;
      cursor = decks[decks.length - 1]?.id;
    } while (cursor);
    await client.indices.refresh({ index: INDEX_NAME });
    return indexed;
  },
};
