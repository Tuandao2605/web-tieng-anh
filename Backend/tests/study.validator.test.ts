import assert from "node:assert/strict";
import test from "node:test";
import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import {
  CreateSetDto,
  GenerateQuizQueryDto,
  ListSetsQueryDto,
} from "../src/modules/study/dto/study.dto";

const validSetId = "64b000000000000000000001";

test("GenerateQuizQueryDto defaults limit and coerces numeric query values", async () => {
  const defaultQuery = plainToInstance(GenerateQuizQueryDto, {});
  assert.equal(defaultQuery.limit, 10);
  assert.deepEqual(await validate(defaultQuery), []);

  const parsed = plainToInstance(GenerateQuizQueryDto, { limit: "25" });
  assert.equal(parsed.limit, 25);
  assert.deepEqual(await validate(parsed), []);
});

test("GenerateQuizQueryDto rejects invalid bounds and non-integer values", async () => {
  for (const limit of ["not-a-number", "0", "101", "1.5"]) {
    const dto = plainToInstance(GenerateQuizQueryDto, { limit });
    assert.notDeepEqual(await validate(dto), [], `expected ${limit} to fail`);
  }
});

test("ListSetsQueryDto validates cursor pagination and defaults page size", async () => {
  const defaultQuery = plainToInstance(ListSetsQueryDto, {});
  assert.equal(defaultQuery.limit, 20);
  assert.deepEqual(await validate(defaultQuery), []);

  const validQuery = plainToInstance(ListSetsQueryDto, {
    cursor: validSetId,
    limit: "50",
  });
  assert.equal(validQuery.limit, 50);
  assert.deepEqual(await validate(validQuery), []);

  for (const query of [
    { cursor: "invalid" },
    { limit: "0" },
    { limit: "51" },
  ]) {
    const dto = plainToInstance(ListSetsQueryDto, query);
    assert.notDeepEqual(await validate(dto), []);
  }
});

test("CreateSetDto preserves defaults, nested card trimming and validation", async () => {
  const dto = plainToInstance(CreateSetDto, {
    title: "Deck",
    cards: [{ term: "  hello  ", definition: "  xin chao  " }],
  });

  assert.equal(dto.isPublic, true);
  assert.equal(dto.cards[0]?.term, "hello");
  assert.equal(dto.cards[0]?.definition, "xin chao");
  assert.deepEqual(await validate(dto), []);

  const invalidDto = plainToInstance(CreateSetDto, {
    title: "",
    cards: [],
  });
  assert.notDeepEqual(await validate(invalidDto), []);
});
