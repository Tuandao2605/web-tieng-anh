import type { StudyService as StudyServiceType } from "./study.service";
import type { enqueueDeckSync } from "../../queues/search-index.queue";

export const STUDY_SERVICE = Symbol("STUDY_SERVICE");
export const STUDY_REPOSITORY = Symbol("STUDY_REPOSITORY");
export const CARD_REPOSITORY = Symbol("CARD_REPOSITORY");
export const USER_PROGRESS_REPOSITORY = Symbol("USER_PROGRESS_REPOSITORY");
export const DECK_SYNC_ENQUEUE = Symbol("DECK_SYNC_ENQUEUE");
export type StudyService = StudyServiceType;
export type DeckSyncEnqueue = typeof enqueueDeckSync;
