import "dotenv/config";
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { InfrastructureModule } from "../infrastructure/infrastructure.module";
import { ElasticsearchService } from "../services/elasticsearch.service";

async function main() {
  const applicationContext = await NestFactory.createApplicationContext(
    InfrastructureModule,
    { logger: false },
  );
  try {
    const indexed = await applicationContext
      .get(ElasticsearchService)
      .reindexPublicDecks();
    process.stdout.write(`Indexed ${indexed} public decks.\n`);
  } finally {
    await applicationContext.close();
  }
}

void main()
  .catch((error) => {
    process.stderr.write(`Reindex failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
