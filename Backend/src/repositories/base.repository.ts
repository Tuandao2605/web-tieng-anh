import { prisma } from "../libs/prisma";

export abstract class BaseRepository<T> {
  protected model;
  constructor(model: string) {
    this.model = (prisma as any)[model];
  }

  async findAll(): Promise<T[]> {
    return await this.model.findMany();
  }

  async findById(id: string | number): Promise<T | null> {
    return await this.model.findUnique({
      where: {
        id,
      },
    });
  }

  async create(data: any): Promise<T> {
    return await this.model.create({
      data,
    });
  }

  async delete(id: string | number): Promise<T> {
    return await this.model.delete({
      where: {
        id,
      },
    });
  }
}
