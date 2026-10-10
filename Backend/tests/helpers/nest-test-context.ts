import { Module, type Provider } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";

export const createNestTestContext = (providers: Provider[]) => {
  class NestTestModule {}
  Module({ providers })(NestTestModule);
  return NestFactory.createApplicationContext(NestTestModule, {
    logger: false,
  });
};
