import { Module } from "@nestjs/common";
import { StudyService } from "./study.service";
import { StudyRepository } from "./study.repository";
import { CardRepository } from "./card.repository";
import { UserProgressRepository } from "./user-progress.repository";
import { enqueueDeckSync } from "../../queues/search-index.queue";
import {
  ApiRateLimitGuard,
  HeavyRateLimitGuard,
  JwtAuthGuard,
  OptionalJwtAuthGuard,
} from "../../common/guards/api.guards";
import {
  PublicDeckSearchController,
  StudyController,
} from "./study.controller";
import {
  CARD_REPOSITORY,
  DECK_SYNC_ENQUEUE,
  STUDY_REPOSITORY,
  STUDY_SERVICE,
  USER_PROGRESS_REPOSITORY,
} from "./study.tokens";

@Module({
  controllers: [StudyController, PublicDeckSearchController],
  providers: [
    StudyRepository,
    { provide: STUDY_REPOSITORY, useExisting: StudyRepository },
    CardRepository,
    { provide: CARD_REPOSITORY, useExisting: CardRepository },
    UserProgressRepository,
    { provide: USER_PROGRESS_REPOSITORY, useExisting: UserProgressRepository },
    { provide: DECK_SYNC_ENQUEUE, useValue: enqueueDeckSync },
    StudyService,
    { provide: STUDY_SERVICE, useExisting: StudyService },
    ApiRateLimitGuard,
    HeavyRateLimitGuard,
    JwtAuthGuard,
    OptionalJwtAuthGuard,
  ],
})
export class StudyModule {}
