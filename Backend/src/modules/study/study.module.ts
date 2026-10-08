import { Module } from "@nestjs/common";
import studyService from "../../services/study.service";
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
import { STUDY_SERVICE } from "./study.tokens";

@Module({
  controllers: [StudyController, PublicDeckSearchController],
  providers: [
    { provide: STUDY_SERVICE, useValue: studyService },
    ApiRateLimitGuard,
    HeavyRateLimitGuard,
    JwtAuthGuard,
    OptionalJwtAuthGuard,
  ],
})
export class StudyModule {}
