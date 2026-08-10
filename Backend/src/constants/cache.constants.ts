const PREFIX = "unicode";
const GLOBAL_VER = "v1";
//Set up time
export const TTL = {
  TINY: 60, // 1m
  SHORT: 300, // 5m
  MEDIUM: 3600, // 1h
  LONG: 86400, // 1d
  WEEK: 604800, // 1w
};

//Quan ly key va tag
export const CACHE = {
  USER: {
    _VER: "v1",
    KEYS: {
      LIST: (
        listVersion: number,
        limit: number,
        page: number,
        hashFilters: string,
      ) => {
        let key = `${PREFIX}:${GLOBAL_VER}:users:${CACHE.USER._VER}:list_v${listVersion}:limit_${limit}_page_${page}`;
        if (hashFilters) {
          key = key + `_hash_${hashFilters}`;
        }
        return key;
      },
      DETAIL: (id: string) =>
        `${PREFIX}:${GLOBAL_VER}:users:${CACHE.USER._VER}:detail:id_${id}`,
    },
    TRACKERS: {
      LIST_VERSION: `${PREFIX}:trackers:users:list_version`,
    },
    TAGS: {
      ROOT: () => [`${PREFIX}:user`],
      DETAIL: (id: string) => [...CACHE.USER.TAGS.ROOT(), id],
      LIST: () => [`${PREFIX}:user-list`],
    },
  },
  PRODUCT: {
    _VER: "v1",
    KEYS: {
      LIST: () => `${PREFIX}:${GLOBAL_VER}:products:${CACHE.USER._VER}:list`,
      DETAIL: (id: string) =>
        `${PREFIX}:${GLOBAL_VER}:products:${CACHE.USER._VER}:detail:id_${id}`,
    },
    TAGS: {
      ROOT: () => [`${PREFIX}:product`],
      DETAIL: (id: string) => [...CACHE.PRODUCT.TAGS.ROOT(), id],
      LIST: () => [`${PREFIX}:product-list`],
    },
  },
  POST: {
    _VER: "v1",
    KEYS: {
      LIST: (listVersion: number) =>
        `${PREFIX}:${GLOBAL_VER}:posts:${CACHE.POST._VER}:list_v${listVersion}`,
      // if (hashFilters) {
      //   key = key + `_hash_${hashFilters}`;
      // }

      DETAIL: (id: string) =>
        `${PREFIX}:${GLOBAL_VER}:posts:${CACHE.POST._VER}:detail:id_${id}`,
    },
    TAGS: {
      ROOT: () => [`${PREFIX}:posts`],
      DETAIL: (id: string) => [...CACHE.PRODUCT.TAGS.ROOT(), id],
      LIST: () => [`${PREFIX}:posts-list`],
    },
    TRACKERS: {
      LIST_VERSION: `${PREFIX}:trackers:posts:list_version`,
    },
  },
};

/*
  Quy tac ve ttl 
1. Độ biến động dữ liệu
- Dữ liệu tĩnh: cấu hình hệ thôngs, danh muc, menu, tỉnh/ thành phố...
+ TTL: LONG/WEEK
+ Chiến lược : Xóa bằng tag khi cập nhật (Hoặc dùng trackerVersion)
- Dữ liệu bán tĩnh : User profile , nội dung bài viết, chi tiết sản phẩm
+ TTL: MEDIUM (1 giờ , vài giờ)
+ Chiến lược: Xóa Tag khi update
- Dữ liệu biến động cao : Giá sản phẩm , số lượng tồn kho, lượt xem 
+ TTL: Tiny/Short 
+ Chiến lược : Để tự cập nhật , tránh dùng Tag => dễ gây áp lực lên Redis

2. Phân cấp TTL 
*/
