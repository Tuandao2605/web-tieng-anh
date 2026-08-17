import "dotenv/config";
import { elasticsearchService } from "../services/elasticsearch.service";
import { prisma } from "../libs/prisma";

async function main() {
  const indexed = await elasticsearchService.reindexPublicDecks();
  process.stdout.write(`Indexed ${indexed} public decks.\n`);
}

void main()
  .catch((error) => {
    process.stderr.write(`Reindex failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
