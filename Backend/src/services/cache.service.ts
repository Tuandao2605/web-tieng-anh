import { redisClient } from "../utils/redis";
const redis = redisClient.getInstance();
export const cacheService = {
  async getOrSet<T>(
    key: string,
    fetchFn: () => Promise<T>,
    ttl: number = 3600,
  ): Promise<T> {
    const cachedData = await redis.get(key);
    if (cachedData) {
      return JSON.parse(cachedData);
    }
    const freshData = await fetchFn();
    if (freshData !== null && freshData !== undefined) {
      //set cache
      await redis.set(key, JSON.stringify(freshData), {
        EX: ttl,
      });
    }
    return freshData;
  },
  async delete(key: string) {
    return redis.del(key);
  },
  async deletePattern(pattern: string) {
    const keys = redis.scanIterator({
      TYPE: "string",
      MATCH: pattern,
    });
    for await (const key of keys) {
      await this.delete(key as unknown as string);
    }
  },
  async getTracker(key: string) {
    let version = await redis.get(key);

    if (!version) {
      version = "1";
      await redis.set(key, version);
    }
    return version;
  },
  async invalidateGetTracker(key: string) {
    const newVersion = await redis.incr(key);
    return newVersion;
  },
  async getOrSetWithTag<T>(
    key: string,
    fetchFn: () => Promise<T>,
    tags: string[],
    ttl: number = 3600,
  ): Promise<T> {
    //kiem tra key co ton tai trong redis hay khong
    const cachedData = await redis.get(key);
    if (cachedData) {
      return JSON.parse(cachedData);
    }
    //Luu du lieu chinh
    const freshData = await fetchFn();
    if (freshData !== null && freshData !== undefined) {
      //multi(transaction)
      const multi = redis.multi();
      multi.set(key, JSON.stringify(freshData), {
        EX: ttl,
      });
      const tagName = `tag:${tags.join(":")}`;
      multi.sAdd(tagName, key);
      multi.expire(tagName, ttl);

      await multi.exec();
    }

    return freshData;
  },

  async invalidateTag(tags: string[]) {
    const prefix = `tag:${tags.join(":")}`;
    const allKeysToDelete = new Set();

    // 1. tim tat ca cac tag key bat dau bang prefix
    // Trien khai : dung scan
    let cursor = "0";
    do {
      const reply = await redis.scan(cursor, {
        MATCH: `${prefix}*`,
        COUNT: 100,
      });
      cursor = reply.cursor;
      const foundTags = reply.keys;

      //2. Tag tim dc , lay danh sach thanh vien
      for (const tagName of foundTags) {
        const memberKeys = await redis.sMembers(tagName);
        memberKeys.forEach((key) => {
          allKeysToDelete.add(key);
        });
        allKeysToDelete.add(tagName);
      }
    } while (cursor !== "0");
    if (allKeysToDelete.size > 0) {
      await redis.unlink(Array.from(allKeysToDelete) as string[]);
    }
    // // Lay cac key thuoc tag
    // const keys = await redis.sMembers(tagName);
    // if (keys.length) {
    //   // Xoa tat ca cac key va chinh tag do
    //   await redis.del([...keys, tagName]);
    // }
    // return true;
  },
  async writeThrough<T>(
    key: string,
    dbAction: () => Promise<T>,
    ttl: number = 3600,
  ) {
    //goi ham dbAction
    const result = await dbAction();
    await redis.set(key, JSON.stringify(result), {
      EX: ttl,
    });
    return result;
  },
};
