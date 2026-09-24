import assert from "node:assert/strict";
import test from "node:test";
import {
  generateQuizSchema,
  listSetsSchema,
} from "../src/validators/study.validator";

const validSetId = "64b000000000000000000001";

test("generateQuizSchema defaults limit to 10", () => {
  const result = generateQuizSchema.parse({
    params: { id: validSetId },
    query: {},
  });

  assert.equal(result.query.limit, 10);
});

test("generateQuizSchema coerces a valid query limit to number", () => {
  const result = generateQuizSchema.parse({
    params: { id: validSetId },
    query: { limit: "25" },
  });

  assert.equal(result.query.limit, 25);
});

test("generateQuizSchema rejects invalid IDs and limits", () => {
  for (const input of [
    { params: { id: "invalid" }, query: { limit: "10" } },
    { params: { id: validSetId }, query: { limit: "not-a-number" } },
    { params: { id: validSetId }, query: { limit: "0" } },
    { params: { id: validSetId }, query: { limit: "101" } },
    { params: { id: validSetId }, query: { limit: "1.5" } },
  ]) {
    assert.equal(generateQuizSchema.safeParse(input).success, false);
  }
});

test("listSetsSchema validates cursor pagination", () => {
  assert.deepEqual(listSetsSchema.parse({ query: {} }).query, { limit: 20 });
  assert.deepEqual(
    listSetsSchema.parse({
      query: { cursor: validSetId, limit: "50" },
    }).query,
    { cursor: validSetId, limit: 50 },
  );

  for (const query of [
    { cursor: "invalid" },
    { limit: "0" },
    { limit: "51" },
  ]) {
    assert.equal(listSetsSchema.safeParse({ query }).success, false);
  }
});
