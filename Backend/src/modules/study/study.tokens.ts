import type { StudyService as StudyServiceType } from "../../services/study.service";

export const STUDY_SERVICE = Symbol("STUDY_SERVICE");
export type StudyService = StudyServiceType;
