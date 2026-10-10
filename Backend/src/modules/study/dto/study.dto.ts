import { Transform, Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from "class-validator";

export class SetIdParamsDto {
  @IsString()
  @MinLength(24, { message: "Set ID must be a MongoDB ObjectId" })
  @MaxLength(24, { message: "Set ID must be a MongoDB ObjectId" })
  id!: string;
}

export class CardInputDto {
  @Transform(({ value }) =>
    typeof value === "string" ? value.trim() : value,
  )
  @IsString()
  @MinLength(1, { message: "Term is required" })
  @MaxLength(255)
  term!: string;

  @Transform(({ value }) =>
    typeof value === "string" ? value.trim() : value,
  )
  @IsString()
  @MinLength(1, { message: "Definition is required" })
  @MaxLength(2000)
  definition!: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @ValidateIf((_object, value: unknown) => value !== "")
  @IsUrl()
  audioUrl?: string | undefined;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  exampleSentence?: string | undefined;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @ValidateIf((_object, value: unknown) => value !== "")
  @IsUrl()
  imageUrl?: string | undefined;
}

export class UpdateCardInputDto extends CardInputDto {
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @MinLength(24, { message: "Card ID must be a MongoDB ObjectId" })
  @MaxLength(24, { message: "Card ID must be a MongoDB ObjectId" })
  id?: string | undefined;
}

export class CreateSetDto {
  @IsString()
  @MinLength(1, { message: "Title is required" })
  @MaxLength(255)
  title!: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  description?: string | undefined;

  @IsBoolean()
  isPublic = true;

  @IsArray()
  @ArrayMinSize(1, { message: "Must contain at least 1 card" })
  @ValidateNested({ each: true })
  @Type(() => CardInputDto)
  cards!: CardInputDto[];
}

export class UpdateSetDto extends CreateSetDto {
  @ArrayMinSize(1, { message: "Must contain at least 1 card" })
  @ArrayMaxSize(500, {
    message: "Can only update up to 500 cards at a time",
  })
  @ValidateNested({ each: true })
  @Type(() => UpdateCardInputDto)
  declare cards: UpdateCardInputDto[];
}

export class AddCardsToSetDto {
  @IsArray()
  @ArrayMinSize(1, { message: "Must contain at least 1 card" })
  @ArrayMaxSize(200, { message: "Can only add up to 200 cards at a time" })
  @ValidateNested({ each: true })
  @Type(() => CardInputDto)
  cards!: CardInputDto[];
}

export class GenerateQuizQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 10;
}

export class ListSetsQueryDto {
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @MinLength(24, { message: "Cursor must be a MongoDB ObjectId" })
  @MaxLength(24, { message: "Cursor must be a MongoDB ObjectId" })
  cursor?: string | undefined;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 20;
}

export class SearchPublicDecksQueryDto {
  @Transform(({ value }) =>
    typeof value === "string" ? value.trim() : value,
  )
  @IsString()
  @MinLength(1, { message: "Search keyword is required" })
  @MaxLength(100)
  q!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 10;
}

export class SubmitAnswerDto {
  @IsString()
  @MinLength(1, { message: "Session ID is required" })
  sessionId!: string;

  @IsString()
  @MinLength(24, { message: "Set ID must be a MongoDB ObjectId" })
  @MaxLength(24, { message: "Set ID must be a MongoDB ObjectId" })
  setId!: string;

  @IsString()
  @MinLength(1, { message: "Study mode is required" })
  mode = "QUIZ";

  @IsString()
  @MinLength(24, { message: "Card ID must be a MongoDB ObjectId" })
  @MaxLength(24, { message: "Card ID must be a MongoDB ObjectId" })
  cardId!: string;

  @IsBoolean()
  isCorrect!: boolean;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  userAnswer?: string | undefined;
}

class BatchAnswerDto {
  @IsString()
  @MinLength(24, { message: "Card ID must be a MongoDB ObjectId" })
  @MaxLength(24, { message: "Card ID must be a MongoDB ObjectId" })
  cardId!: string;

  @IsBoolean()
  isCorrect!: boolean;
}

export class SubmitAnswersDto {
  @IsString()
  @MinLength(1, { message: "Session ID is required" })
  sessionId!: string;

  @IsString()
  @MinLength(24, { message: "Set ID must be a MongoDB ObjectId" })
  @MaxLength(24, { message: "Set ID must be a MongoDB ObjectId" })
  setId!: string;

  @IsString()
  @MinLength(1, { message: "Study mode is required" })
  mode = "QUIZ";

  @IsArray()
  @ArrayMinSize(1, { message: "At least one answer is required" })
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => BatchAnswerDto)
  answers!: BatchAnswerDto[];
}

export class SyncProgressDto {
  @IsString()
  @MinLength(1, { message: "Session ID is required" })
  sessionId!: string;
}
