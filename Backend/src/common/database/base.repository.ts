type CrudModel<T> = {
  findMany: () => Promise<T[]>;
  findUnique: (args: { where: { id: string | number } }) => Promise<T | null>;
  create: (args: { data: unknown }) => Promise<T>;
  delete: (args: { where: { id: string | number } }) => Promise<T>;
};

export abstract class BaseRepository<T, Model> {
  protected readonly model: Model;
  private readonly crudModel: CrudModel<T>;

  constructor(model: Model) {
    this.model = model;
    this.crudModel = model as unknown as CrudModel<T>;
  }

  async findAll(): Promise<T[]> {
    return this.crudModel.findMany();
  }

  async findById(id: string | number): Promise<T | null> {
    return this.crudModel.findUnique({
      where: {
        id,
      },
    });
  }

  async create(data: unknown): Promise<T> {
    return this.crudModel.create({
      data,
    });
  }

  async delete(id: string | number): Promise<T> {
    return this.crudModel.delete({
      where: {
        id,
      },
    });
  }
}
