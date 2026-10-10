import type { Client } from "@elastic/elasticsearch";
import type { ElasticsearchService } from "./elasticsearch.service";

export const ELASTICSEARCH_CLIENT = Symbol("ELASTICSEARCH_CLIENT");
export const ELASTICSEARCH_SERVICE = Symbol("ELASTICSEARCH_SERVICE");
export type ElasticsearchClientProvider = Client;
export type ElasticsearchProvider = ElasticsearchService;
