# Nhật ký lỗi, cách khắc phục và luồng xử lý

> Cập nhật: 11/10/2026. Tài liệu bổ sung cho [Cẩm nang Tech Lead](TAI_LIEU_TECH_LEAD_DU_AN.md), ghi lại các lỗi/rủi ro đã gặp, cách code hiện tại xử lý, luồng sau khi sửa và các giới hạn chưa được khắc phục triệt để.

## Trạng thái

- **Đã xử lý**: implementation hiện tại có xử lý và/hoặc test xác nhận.
- **Vận hành/cấu hình**: lỗi do service chưa sẵn sàng hoặc cấu hình chạy sai.
- **Còn giới hạn**: đã giảm rủi ro nhưng chưa có bảo đảm tuyệt đối.

## Luồng tổng thể

```text
Browser → Vite/Nginx → NestJS + Fastify (:3000)
       → Guard (JWT/rate limit/blacklist) → DTO/Pipe
       → Controller → Service → Repository → MongoDB
                              ↘ Redis (cache/session/queue/shared state)
```

Mutation đã commit DB không nên bị báo lỗi chỉ vì side effect cache/search thất bại. Muốn bảo đảm side effect qua process restart cần transactional outbox.

## 1. Backend không nghe ở cổng 3000: ECONNREFUSED / Network Error / 502

**Biểu hiện:** Vite báo `connect ECONNREFUSED 127.0.0.1:3000` với `/api/v1/auth/login`; browser có thể hiện Network Error hoặc HTTP 502.

**Nguyên nhân:** Proxy không kết nối được tới upstream: Nest chưa chạy, bootstrap thất bại hoặc port giữa frontend/proxy/backend không khớp. 502 tự nó không chứng minh API login có lỗi.

**Cách xử lý và luồng đúng:** Nest đọc `NEST_PORT`, rồi `PORT`, mặc định 3000 và bind `0.0.0.0`. Vite/Nginx phải trỏ cùng port.

```text
Vite/Nginx → :3000 → Nest Fastify → /api/v1/auth/login
```

Kiểm tra log khởi động và gọi health endpoint trực tiếp ở port 3000 trước khi debug frontend/CORS. Code: [main.ts](Backend/src/main.ts), [vite.config.ts](Frontend/vite.config.ts).

## 2. Redis ECONNREFUSED lúc khởi động

**Biểu hiện:** `ECONNREFUSED 127.0.0.1:6379`, sau đó log báo Main/Publisher/Subscriber Redis connected.

**Nguyên nhân:** Redis chưa nghe ở host/port cấu hình lúc client kết nối.

**Cách xử lý/luồng:** `REDIS_URL` (hoặc `REDIS_HOST`/`REDIS_PORT`) chọn endpoint; client reconnect với delay tăng dần, giới hạn 3 giây. Kiểm tra Redis/container và `redis-cli ping`; lỗi này là readiness/vận hành, không phải lỗi route Nest. Code: [redis.ts](Backend/src/utils/redis.ts).

## 3. Fastify lỗi FST_ERR_CTP_ALREADY_PRESENT

**Biểu hiện:** `Content type parser 'application/x-www-form-urlencoded' already present`.

**Nguyên nhân:** Parser cùng content type được đăng ký cả bởi Nest Fastify và code/plugin tùy chỉnh.

**Cách xử lý/luồng:** Chỉ để một parser sở hữu content type; bootstrap hiện đăng ký cookie/CORS/helmet, không thêm parser form trùng.

```text
HTTP body → parser Fastify/Nest duy nhất → DTO/Pipe → Controller
```

**Trạng thái:** Đã xử lý. Nếu tái diễn, tìm đăng ký `addContentTypeParser`, `useBodyParser` hoặc plugin parser bổ sung.

## 4. Token rác làm đầy JWT L1 và tiêu tốn CPU

**Rủi ro:** Cache cả token sai với `userId = undefined` cho phép attacker gửi hàng loạt token ngẫu nhiên, gây cache pollution/eviction.

**Cách xử lý:** [AccessTokenService](Backend/src/common/services/access-token.service.ts) giới hạn kích thước Authorization/JWT, kiểm tra JWT shape trước khi verify; chỉ cache principal đã xác thực hợp lệ (positive-only). TTL cache bị chặn bởi JWT `exp`, có giới hạn số entry/LRU.

```text
Bearer → giới hạn kích thước + kiểm tra shape → L1 hit hoặc verify chữ ký
       → validate claims/exp → cache principal hợp lệ
```

Guard dùng principal đó và ghép token bucket với blacklist trong một Redis pipeline. Đây không thay thế rate limit ở Nginx.

### Refresh token bị dùng hai lần đồng thời

Refresh token là one-time token: `refreshToken()` dùng Redis `GETDEL` để chỉ một request lấy/xóa được refresh record cũ. Request đua còn lại không tìm thấy record nên bị từ chối; request thắng tạo và lưu refresh token mới.

```text
Hai request cùng refresh token → GETDEL atomic → một request thắng
  → cấp token mới; request còn lại → invalid/expired
```

Test integration xác nhận refresh token cũ chỉ xoay được một lần. Code: [api-auth.service.ts](Backend/src/modules/auth/api-auth.service.ts).

## 5. Cache bài viết có nguy cơ lẫn dữ liệu giữa user

**Nguyên nhân cần tránh:** Query phụ thuộc user nhưng cache key chỉ dùng chung cho mọi user.

**Cách xử lý:** Key list có `userId` và version; repository cũng query theo `userId`; tạo post tăng tracker để key cũ không còn được dùng.

```text
JWT → userId → list-version → key(userId, version)
    → Prisma findMany theo userId → lưu cache
```

Code: [posts.service.ts](Backend/src/modules/posts/posts.service.ts), [cache.constants.ts](Backend/src/constants/cache.constants.ts), [posts.repository.ts](Backend/src/modules/posts/posts.repository.ts). Integration test kiểm tra cache isolation trong [core-flows.integration.test.ts](Backend/tests/integration/core-flows.integration.test.ts).

## 6. Cache stampede, invalidation race và tag set rác

### Bản đồ các cải tiến cache theo mục tiêu

Phần này tổng hợp những thay đổi cache nằm rải rác ở các mục trước: mục tiêu nghiệp vụ là không trộn dữ liệu/không trả dữ liệu cũ sau mutation; mục tiêu hiệu năng là giảm DB/Redis work trên read path nhưng có giới hạn khi dependency lỗi.

| Mục tiêu | Cơ chế hiện tại | Luồng sau cải tiến |
| --- | --- | --- |
| Không lẫn bài viết giữa user | Key list chứa `userId` và version; repository query cũng lọc đúng `userId` | JWT → userId → key riêng → query cùng userId → cache |
| Không lộ deck private qua cache | Cache deck detail theo deck/version; mỗi request vẫn kiểm tra `isPublic` hoặc `set.userId === userId` trước khi trả | L2 hit/miss → lấy deck → kiểm tra ownership → trả data hoặc 404 |
| Không giữ list cũ sau create/update/delete | Tracker version riêng cho public list, user list và deck detail; mutation tăng tracker thay vì SCAN toàn cache | Mutation DB → tăng version phù hợp → request kế tiếp dùng key version mới |
| Giảm latency cho dữ liệu nóng | L1 RAM bounded (mặc định TTL tối đa 5s, LRU giới hạn entry/byte) trước L2 Redis | L1 hit → trả ngay; L1 miss → L2; cả hai miss → source DB |
| Trả nhanh khi cache vừa stale | L1/L2 SWR opt-in theo call-site; Redis giữ record đến hết stale window | stale hit → trả data cũ ngay → single-flight refresh nền → cập nhật L2/L1 |
| Chặn cache penetration cho ID không tồn tại | Negative cache opt-in; set detail cấu hình TTL ngắn mặc định 30s | miss → query DB → nếu null thì lưu tombstone ngắn → request lặp lại không query DB ngay |
| Không nhân nhiều query khi cache miss | `inFlight` trong process + Redis fill lock giữa process; waiter poll có jitter | Một owner fetch DB; waiter thường chờ L2. Nếu hết lượt chờ/lock, code có thể fallback DB với giới hạn theo process (xem giới hạn bên dưới). |
| Không cho fill cũ ghi đè mutation mới | Redis monotonic generation/fencing và Lua conditional write | mutation/invalidation thu hồi lock → fill cũ mất fence → Redis từ chối SET cũ |
| Không để Redis outage làm sập mọi cache-read | Circuit breaker + fallback DB giới hạn theo process, không cache kết quả fallback | Redis lỗi → DB nếu còn slot → nếu hết slot trả 503 |
| Không biến cache lỗi thành mutation lỗi | Cache write/invalidation sau DB commit được bắt riêng; retry queue RAM có backoff | DB commit → evict L1 → Redis side effect → lỗi thì enqueue, vẫn trả kết quả DB |
| Giảm chi phí invalidation | Tag chính xác, reverse index dọn member; maintenance scan gửi message theo batch 500 key | mutate → Lua xóa key/index/tag atomically → một Pub/Sub batch thay vì từng key |
| Không tải cả kho deck vào một response | Cursor pagination; page key chứa scope/version/limit/cursor | request page → Prisma lấy `limit + 1` → trả page và next cursor |

Những điểm kiểm tra ownership/version nằm ở [study.service.ts](Backend/src/modules/study/study.service.ts), [posts.service.ts](Backend/src/modules/posts/posts.service.ts), [users.service.ts](Backend/src/modules/users/users.service.ts) và [cache.constants.ts](Backend/src/constants/cache.constants.ts). Cơ chế L1/L2, SWR, lock, fencing, tag và retry tập trung tại [cache.service.ts](Backend/src/modules/cache/cache.service.ts).

### Cache miss và lock

**Rủi ro:** Nhiều Node process cùng miss cache có thể cùng query DB; waiter poll đồng bộ cũng tạo burst.

**Cách xử lý:** `inFlight` gộp yêu cầu trong process; Redis distributed lock phối hợp process; waiter có jitter. Monotonic Redis generation là fencing token; Lua chỉ cho owner hiện tại ghi L2. Invalidation thu hồi fill/lock đang hoạt động.

```text
L1 miss → single-flight → L2 miss → Redis lock + generation
       → owner fetch DB → Lua kiểm tra fence → ghi L2/L1
```

**Còn giới hạn:** Khi hết số lần thử lock, read path có thể chuyển sang DB fallback. Giới hạn fallback là theo process, không phải toàn cụm; tải nhiều instance cần giám sát/backpressure bổ sung.

### Tag invalidation

**Rủi ro trước đây:** Prefix `startsWith` có thể xóa nhầm tag gần giống (ví dụ `user` và `user2`); key bị xóa nhưng member sót ở tag set khác.

**Cách xử lý:** So khớp tag chính xác; reverse index lưu các tag liên quan tới key; Lua xóa key đồng thời dọn tag set/zset và index.

### Pattern scan và Pub/Sub storm

**Rủi ro:** SCAN keyspace không thích hợp request thường xuyên; publish một message mỗi key tạo bão Pub/Sub.

**Cách xử lý:** Chuyển quét pattern sang [CacheMaintenanceService](Backend/src/modules/cache/cache.service.ts); xóa theo batch tối đa 500 key và gửi một message `keys-batch`/batch. Không gọi thao tác maintenance trên request nghiệp vụ.

## 7. SWR tầng L2 và cache dữ liệu không tồn tại

**Rủi ro:** Redis hard TTL xóa key hoàn toàn; SWR chỉ ở L1 không cứu được request sau khi L1 eviction. ID không tồn tại cũng có thể xuyên cache xuống DB lặp lại.

**Cách xử lý:** Khi caller bật SWR, L2 lưu payload cùng `freshUntil`/`staleUntil` và đặt Redis TTL tới hết stale window. Đọc stale trả data ngay, rồi refresh nền qua single-flight/lock. Negative caching opt-in, lưu `null` với TTL ngắn do caller cấu hình.

```text
L1 stale → trả stale + refresh nền
L1 miss → L2 fresh: trả | L2 stale: trả + refresh nền
Hết stale window/cache miss → fetch source of truth
```

## 8. Redis outage: fail-open có giới hạn cho cache-read

**Rủi ro:** Cache miss khi Redis hỏng làm request lỗi; bỏ qua Redis không giới hạn lại có thể dồn tải vào MongoDB.

**Cách xử lý:** Read path mở circuit breaker/backoff, gọi source dưới giới hạn `CACHE_DB_FALLBACK_MAX_CONCURRENT` (mặc định 50/process). Khi đầy trả 503; fallback không ghi L1/L2. Sau cooldown chỉ một request probe Redis.

```text
Redis lỗi/circuit mở → còn slot: query DB, trả không cache
                  → hết slot: 503
```

Đây là fail-open cho cache-read, không mặc định áp dụng cho auth/rate-limit. Giới hạn 50 là mỗi process; tổng tải có thể tăng theo số worker.

## 9. DB commit thành công nhưng cache invalidation lỗi

**Rủi ro:** Nếu cache write/invalidate ném lỗi sau DB commit, client nhận thất bại và retry có thể lặp mutation.

**Cách xử lý:** Cache side effect được tách khỏi kết quả nghiệp vụ: xóa L1 tại chỗ; thử Redis write/invalidation; nếu lỗi thì không ném ngược cho mutation mà enqueue retry RAM có backoff. Pub/Sub best-effort; retry thành công sẽ phát notification lại.

```text
DB commit → local L1 evict → thử Redis cache/invalidation
         ├─ thành công: publish → trả kết quả DB
         └─ lỗi: queue retry → vẫn trả kết quả DB
                    → Redis phục hồi → retry invalidation
```

Code: [cache.service.ts](Backend/src/modules/cache/cache.service.ts), usage: [users.service.ts](Backend/src/modules/users/users.service.ts).

**Giới hạn:** Retry queue chỉ trong RAM, tối đa 10.000 entry; process restart hoặc queue đầy có thể mất invalidation. Muốn bảo đảm durable cần transactional outbox trong DB.

## 10. Study session: concurrent update và sync retry

**Lost update:** GET → sửa trong Node → SET không atomic. Submit answer hiện dùng Lua để cập nhật session Redis atomically; sync có lock theo session với token-checked release và TTL.

**Session trùng khi retry:** Nếu Mongo transaction commit nhưng Redis chưa bị xóa, retry có thể lặp sync. ID StudySession xác định từ `userId + clientSessionId`; Mongo transaction upsert theo ID đó. Nếu session đã tồn tại, retry trả lại record cũ rồi dọn Redis.

```text
Redis session → lock → tìm deterministic ID trong Mongo
  → đã có: trả record cũ + xóa Redis
  → chưa có: transaction upsert session + bulk progress → xóa Redis
```

Code: [study.service.ts](Backend/src/modules/study/study.service.ts), [user-progress.repository.ts](Backend/src/modules/study/user-progress.repository.ts). Có test integration/product cho retry và concurrency.

## 11. Danh sách deck lớn và Elasticsearch làm chậm API ghi

**Rủi ro:** Trả mọi deck làm phình DB work/response/RAM; chờ Elasticsearch trong HTTP mutation làm response phụ thuộc search.

**Cách xử lý:** `listSets` dùng cursor, giới hạn trang và trả `hasMore/nextCursor`. Search indexing được enqueue cho worker sau DB write.

```text
GET sets(cursor, limit) → Prisma lấy limit + 1 → page + nextCursor
Mutation MongoDB → queue job → worker → Elasticsearch
```

Search có eventual consistency ngắn: MongoDB có thể mới hơn Elasticsearch. Code: [study.repository.ts](Backend/src/modules/study/study.repository.ts), [search-index.worker.ts](Backend/src/workers/search-index.worker.ts).

## 12. Lỗi TypeScript/lint trong lúc chuyển Nest/Fastify

Đã gặp tham số implicit `any` (ví dụ `issue`) và ESLint `no-console` với `console.info`. Đây là lỗi build/lint, không phải lỗi HTTP runtime; đã bổ sung type/cách log phù hợp. Xác minh hiện tại bằng `npm run lint` và `npm run build` trong Backend.

Các lỗi compile khác trong giai đoạn chuyển gateway cũng đã được xử lý: Socket.IO `Server` không có `.on()` theo type đã dùng nên đăng ký qua `server.sockets.on`; callback nhận `Socket` type rõ ràng; bỏ callback parameter thừa gây `no-unused-vars`. Code hiện tại: [socket-io.gateway.ts](Backend/src/modules/web/socket-io.gateway.ts).

## 13. CPU bị đốt trước khi rate limiter trong ứng dụng chạy

**Rủi ro:** Nếu mọi request đều đi tới Node trước khi bị giới hạn, request rác vẫn tốn CPU parse header, xác thực JWT và chạy guard.

**Cách xử lý theo lớp:** Nginx giới hạn request/connection và có zone riêng cho auth; API kiểm tra nhanh kích thước/shape JWT trước verify; Redis token bucket là quota dùng chung giữa Node instance. Khi có JWT hợp lệ, access token được verify một lần rồi blacklist check đi cùng token bucket trong pipeline.

```text
Internet → Nginx edge limit → Fastify header/body parse
         → fast JWT reject/cache → Redis token bucket + blacklist
         → controller/service
```

Ví dụ cấu hình edge ở [nginx/default.conf](nginx/default.conf). Đây là nhiều lớp bổ sung nhau; Nginx không thay thế rate limit theo user, còn Redis rate limiter hiện fail-open nếu Redis lỗi ở global guard. Vì vậy cần giữ edge limit và monitor Redis.

## 14. Chuyển Express sang NestJS/Fastify và giữ API contract

**Rủi ro migration:** Thay framework có thể làm đổi URL, status code, response envelope, cookie/session hoặc khiến Express và Nest cùng mở port/chạy worker.

**Cách xử lý:** API được đưa vào Nest modules/controllers, Fastify là HTTP adapter; interceptor/filter giữ envelope tương thích `{ obj: { success, data, message } }` và status contract. Prisma/Redis/cache được cung cấp qua Nest providers; service/repository nghiệp vụ nhận dependency qua constructor injection. Validation đặt trong DTO/Pipe theo module, không để validator rời rạc không được dùng.

```text
Nest bootstrap → AppModule → feature module → controller/guard
              → service (nghiệp vụ) → repository (truy cập dữ liệu)
```

EJS và session được giữ lại trong module Web; Socket.IO gateway chạy qua Nest lifecycle; worker/scheduler chỉ được phép khởi động với `BACKGROUND_RUNTIME_ROLE=worker` để tránh API process và worker chạy trùng. Code liên quan: [main.ts](Backend/src/main.ts), [api-envelope.interceptor.ts](Backend/src/common/interceptors/api-envelope.interceptor.ts), [backgroundRuntime.ts](Backend/src/utils/backgroundRuntime.ts), [worker.ts](Backend/src/worker.ts).

## 15. Session web đồng thời và Socket.IO

### Web session

Session JSON/cookie cũ được giữ để tương thích browser sau migration. Tuy nhiên, implementation hiện đọc session lúc attach rồi `save()` ghi nguyên object bằng `SET`. Hai request đồng thời cùng session vẫn có khả năng ghi đè thay đổi của nhau.

**Trạng thái: còn giới hạn.** Đây là điểm cần CAS/version hoặc cập nhật atomic bằng Lua (và test race) nếu cùng session có các thao tác ghi đồng thời; không nên ghi rằng lỗi lost-update đã được giải quyết hoàn toàn chỉ vì session đã chuyển sang Nest.

Code: [web-session.service.ts](Backend/src/modules/web/web-session.service.ts).

### Socket.IO

**Lỗi compile đã xử lý:** event listener được chuyển sang API/type phù hợp như mục 12.

**Rủi ro bảo mật còn lại:** gateway hiện nhận `send-message`, `join-room`, `send-noti` mà chưa thấy guard xác thực/rate limit/ủy quyền room. CORS chỉ kiểm soát origin của browser, không phải xác thực danh tính. Cần xử lý trước khi bật các event này cho production hoặc giới hạn chặt dữ liệu/event.

## 16. Test ít và benchmark không đại diện production

**Khoảng trống đã được cải thiện:** ngoài unit test, hiện có integration test cho auth/cache/study và Redis thật; product stack dựng HTTP qua Nginx, nhiều Node instance và các dependency cần thiết. Có open-loop load generator để thử offered load, bao gồm mục tiêu tới 5.000 request/s.

**Điều chưa thể kết luận:** có kịch bản target 5.000 RPS không có nghĩa sản phẩm đã đạt 5.000 RPS. Cần đo achieved RPS, p95/p99, error rate, CPU/RAM và Redis/Mongo saturation; so sánh Node trực tiếp với Nginx và chạy generator trên máy riêng. Kết quả một endpoint hoặc một lần chạy ngắn không đủ kết luận production capacity.

Test chính ở [production-stack.test.ts](Backend/tests/product/production-stack.test.ts), [open-loop-http-load.cjs](Backend/tests/product/open-loop-http-load.cjs), và [redis.integration.test.ts](Backend/tests/integration/redis.integration.test.ts). Trong workspace hiện không thấy workflow CI; tự chạy `npm test` không đồng nghĩa CI đã được thiết lập.

## Các quyết định nghiệp vụ không phải bug

- **`isCorrect` do frontend gửi** là lựa chọn có chủ đích cho chế độ tự học: người học tự đánh giá câu trả lời. Không dùng cơ chế này cho kỳ thi có điểm/chứng chỉ hoặc cần chống gian lận.
- **Quiz trả `isCorrect` trong options** cũng phù hợp với UX tự học hiện tại. Nếu thêm exam mode, cần tạo contract khác không gửi đáp án đúng trước khi nộp bài.
- **Elasticsearch eventual consistency** sau mutation là trade-off để không chặn API write; job lỗi cần được retry/quan sát, không đồng nghĩa MongoDB write thất bại.

## Giới hạn cần nhớ

1. **Redis Cluster chưa được hỗ trợ đầy đủ.** Redis client hiện là single-node; cache Lua còn tham chiếu key phụ qua prefix/ARGV và chưa dùng chung hash tag/hash slot. Không bật Cluster nếu chưa thiết kế lại mọi key script vào `KEYS` và cùng slot.
2. **Invalidation retry không durable.** Cần transactional outbox nếu không chấp nhận mất event khi restart.
3. **Pub/Sub không phải event log bền vững.** Nếu notification không đến, L1 process khác có thể stale tới khi TTL ngắn hết hoặc invalidation retry thành công.
4. **DB fallback/cache lock có giới hạn theo process**, không theo toàn cụm.
5. `isCorrect` do client gửi là lựa chọn có chủ đích cho self-study; không phù hợp cho thi cử/chứng chỉ/điểm thưởng cần chống gian lận.

## Lệnh kiểm tra backend

```bash
cd Backend
npm test
npm run lint
npm run build
```

Redis integration test cần Redis local/môi trường test. Product test gần production hơn nhưng không tự chứng minh SLA production; cần đo p95/p99, tỷ lệ lỗi, CPU/RAM, Redis và MongoDB trên hạ tầng tương ứng.
