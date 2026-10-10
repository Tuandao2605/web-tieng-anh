import { Global, Module } from "@nestjs/common";
import { InfrastructureModule } from "../../config/infrastructure.module";
import { ElasticsearchService, elasticsearchClient } from "./elasticsearch.service";
import { ELASTICSEARCH_CLIENT, ELASTICSEARCH_SERVICE } from "./elasticsearch.tokens";

@Global()
@Module({
  imports: [InfrastructureModule],
  providers: [
    { provide: ELASTICSEARCH_CLIENT, useValue: elasticsearchClient },
    ElasticsearchService,
    { provide: ELASTICSEARCH_SERVICE, useExisting: ElasticsearchService },
  ],
  exports: [ElasticsearchService, ELASTICSEARCH_SERVICE],
})
export class ElasticsearchModule {}
