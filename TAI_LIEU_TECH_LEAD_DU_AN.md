# Cẩm nang Tech Lead — Hệ thống học tiếng Anh bằng flashcard

> Tài liệu này là giáo trình kỹ thuật, tài liệu onboarding và bản review kiến trúc của codebase tại thời điểm hiện tại. Mục tiêu không chỉ là biết “file nào làm gì”, mà còn hiểu vì sao hệ thống được thiết kế như vậy, giới hạn ở đâu và phải đặt câu hỏi gì trước khi phát triển tiếp.

## 1. Tóm tắt điều hành

Đây là một ứng dụng tự học tiếng Anh theo mô hình flashcard/Quizlet, gồm các khả năng chính:

- Đăng ký, đăng nhập, refresh token, đăng xuất và quên mật khẩu.
- Tạo, sửa, xóa bộ thẻ; hỗ trợ bộ công khai và riêng tư.
- Xem flashcard, học, viết đáp án và làm quiz.
- Ghi tạm tiến trình học trong Redis rồi đồng bộ bền vững sang MongoDB.
- Tìm kiếm bộ thẻ công khai bằng Elasticsearch.
- Chạy nhiều Node instance sau Nginx và dùng Redis làm trạng thái dùng chung.
- Cache hai tầng L1 trong RAM + L2 Redis.
- BullMQ xử lý đồng bộ chỉ mục tìm kiếm ngoài request chính.
- Bộ test từ unit, integration Redis đến product test với Nginx, hai Node, MongoDB, Redis, Elasticsearch và network latency giả lập.

Kiến trúc hiện tại có nền tảng tốt cho một sản phẩm học tập quy mô nhỏ đến vừa. Những điểm mạnh nhất là phân tách lớp khá rõ, kiểm soát đồng thời bằng Redis Lua, refresh-token rotation atomic, cache có isolation theo người dùng, cursor pagination và test nhiều instance. Các phần chưa nên gọi là production-ready gồm WebSocket thử nghiệm, chiến lược lưu token phía frontend, một số API/feature mẫu, observability và transactional outbox cho Elasticsearch.

## 2. Cách đọc tài liệu này

Nếu bạn mới vào dự án, hãy đọc theo thứ tự:

1. Kiến trúc tổng thể.
2. Luồng một HTTP request.
3. Mô hình dữ liệu.
4. Luồng xác thực.
5. Luồng flashcard và học tập.
6. Chương cache.
7. Chương concurrency và distributed systems.
8. Các tối ưu, kết quả test và nợ kỹ thuật.
9. Bộ câu hỏi nghiệp vụ phản biện.

Nếu bạn đang debug, hãy đi thẳng tới “Bản đồ code” và “Runbook chẩn đoán”.

---

## 3. Sản phẩm đang giải quyết bài toán gì?

### 3.1 Actor chính

| Actor | Khả năng hiện tại |
| --- | --- |
| Khách chưa đăng nhập | Xem danh sách bộ công khai, xem chi tiết bộ công khai, tìm kiếm và tạo quiz từ bộ công khai |
| Học viên đã đăng nhập | Có toàn bộ quyền của khách; xem bộ riêng của chính mình; tạo/sửa/xóa bộ; học và lưu tiến trình |
| Chủ bộ thẻ | Sửa thông tin, thay danh sách card, thêm card hàng loạt, đổi public/private, xóa bộ |
| Worker nền | Nhận BullMQ job và đồng bộ bộ thẻ sang Elasticsearch |
| Quản trị viên | Chưa có role và use case quản trị hoàn chỉnh trong domain hiện tại |

### 3.2 Các ranh giới nghiệp vụ quan trọng

- Bộ công khai được mọi người đọc.
- Bộ riêng tư chỉ chủ sở hữu được đọc; người ngoài nhận `404` thay vì `403` để không lộ sự tồn tại.
- Chỉ chủ sở hữu được sửa/xóa/thêm card vào bộ.
- Kết quả đúng/sai của quiz do client tự đánh giá và gửi lên. Đây là **thiết kế chủ đích cho trải nghiệm tự học**, không phải cơ chế thi cử chống gian lận.
- Search có tính eventual consistency: MongoDB có thể cập nhật trước Elasticsearch một khoảng ngắn.
- Redis giữ trạng thái phiên học tạm thời; MongoDB là dữ liệu bền vững sau khi sync.

### 3.3 Điều không nên hiểu nhầm

- `isCorrect` từ client phù hợp với self-study, nhưng không phù hợp nếu sau này điểm được dùng cấp chứng chỉ, xếp hạng, phần thưởng hoặc chống gian lận.
- API quiz trả `isCorrect` trong từng option là phù hợp với UI hiện tại, vì UI tự chấm. Nó không phù hợp với bài thi bảo mật đáp án.
- Cache dùng để giảm tải, không phải nguồn dữ liệu chuẩn. MongoDB vẫn là source of truth của domain; Redis là source of truth tạm thời cho quota, revocation và phiên học chưa sync.
- Product test gần production hơn unit test, nhưng không phải bằng chứng SLA cho hạ tầng thật.

---

## 4. Kiến trúc tổng thể

```text
Browser / React
      |
      | HTTP + Bearer JWT
      v
Nginx: edge rate limit, connection limit, header-size guard
      |
      v
NestJS + Fastify API instances (có thể chạy nhiều instance)
      |
      +--> Redis
      |      - cache L2
      |      - rate-limit token bucket
      |      - access-token blacklist
      |      - refresh/reset one-time token
      |      - web session
      |      - study session tạm thời
      |      - BullMQ
      |      - Pub/Sub invalidation L1
      |
      +--> MongoDB replica set qua Prisma
      |      - user, phone, post
      |      - flashcard set, card
      |      - progress, study session
      |
      +--> Elasticsearch
             - chỉ mục bộ thẻ công khai

Mongo mutation --> BullMQ job --> Search worker --> Elasticsearch
```

### 4.1 Stack kỹ thuật

| Lớp | Công nghệ | Vai trò |
| --- | --- | --- |
| UI | React 19, React Router | Màn hình và điều hướng |
| Client state | Zustand | Auth state, study session cục bộ |
| Server state | TanStack Query | Cache dữ liệu API phía browser |
| HTTP client | Axios | Gắn token, refresh token, chuẩn hóa response |
| API | NestJS + Fastify + TypeScript | Modules, controllers, guards, interceptors và orchestration |
| Validation | Zod | Parse/coerce/validate input tại biên API |
| ORM | Prisma | Truy cập MongoDB và transaction |
| Database | MongoDB 7 replica set | Dữ liệu bền vững |
| Shared state/cache | Redis 7 | Cache, token, lock, session, rate limit, queue |
| Search | Elasticsearch 8 | Full-text search bộ công khai |
| Job queue | BullMQ | Tách đồng bộ search khỏi request ghi |
| Reverse proxy | Nginx | Bảo vệ biên, proxy và keep-alive |
| Test | Node test runner | Unit, integration, load và product stack |

### 4.2 Các lớp backend

```text
Nest Module
  -> Controller route
      -> Guards / Pipes / Interceptors
          -> Service
              -> Repository
                  -> Prisma/MongoDB
              -> Redis/Queue/Elasticsearch
```

- **Module/controller** tổ chức và khai báo method/URL.
- **Guard/Pipe/Interceptor/Filter** xử lý auth, rate limit, validation, CSRF, envelope và error.
- **Controller** chuyển HTTP input thành lời gọi service và tạo HTTP response.
- **Service** chứa use case, cache, invalidation, orchestration và quy tắc nghiệp vụ.
- **Repository** chứa truy vấn dữ liệu và transaction.

Không phải mọi module cũ đều tuân thủ tuyệt đối cấu trúc này. `users.service.ts` vẫn gọi Prisma trực tiếp; đây là nợ kiến trúc chấp nhận được trong codebase học tập nhưng nên thống nhất khi dự án lớn hơn.

### 4.3 Hai giao diện web song song

Hệ thống có hai kiểu giao diện:

1. React SPA dùng JWT API — đây là luồng sản phẩm học tập chính.
2. EJS server-rendered chạy trong Nest/Fastify; Redis session, flash message và CSRF được quản lý bằng các provider/guard của Nest.

Bootstrap hiện nằm tại [main.ts](Backend/src/main.ts). Redis session/flash chỉ được gắn lên các route web cần chúng (`/auth/*`, `/test-redis`, `/test-mq`); API JWT và static page không phải đọc/ghi web session.

---

## 5. Bản đồ thư mục và file quan trọng

### 5.1 Backend

| Khu vực | File đầu mối | Trách nhiệm |
| --- | --- | --- |
| Bootstrap | [main.ts](Backend/src/main.ts) | Khởi tạo Nest/Fastify, middleware tương thích session, plugins và graceful shutdown |
| Runtime config | [runtime.ts](Backend/src/config/runtime.ts) | CORS, session, timeout, production guard |
| API routes | [app.module.ts](Backend/src/app.module.ts), các feature controller trong `Backend/src/modules/` | Đăng ký modules và endpoint v1 |
| Auth | [apiAuth.service.ts](Backend/src/services/apiAuth.service.ts) | Login, refresh, logout, reset password |
| JWT L1 | [accessToken.service.ts](Backend/src/services/accessToken.service.ts) | Fast reject, verify một lần, positive-only LRU |
| Rate limit | [rateLimit.service.ts](Backend/src/services/rateLimit.service.ts) | Token bucket Lua + blacklist pipeline |
| Study domain | [study.service.ts](Backend/src/services/study.service.ts) | Cache, CRUD deck, quiz, tiến trình học |
| Study query | [study.repository.ts](Backend/src/repositories/study.repository.ts) | Pagination, ownership, transaction deck/card |
| Durable progress | [user-progress.repository.ts](Backend/src/repositories/user-progress.repository.ts) | Idempotent sync và bulk update progress |
| Cache | [cache.service.ts](Backend/src/services/cache.service.ts) | L1/L2, single-flight, fill lock, tag invalidation |
| Search | [elasticsearch.service.ts](Backend/src/services/elasticsearch.service.ts) | Mapping, search, index/delete/reindex |
| Queue | [search-index.queue.ts](Backend/src/queues/search-index.queue.ts) | Job options và enqueue |
| Worker | [search-index.worker.ts](Backend/src/workers/search-index.worker.ts) | Consume job search-index |
| Schema | [study.prisma](Backend/src/prisma/models/study.prisma) | Deck, card, progress, session và index |
| Validators | [study.validator.ts](Backend/src/validators/study.validator.ts) | Giới hạn input study |
| Edge proxy | [default.conf](nginx/default.conf) | Rate/connection/header limits |

### 5.2 Frontend

| Khu vực | File đầu mối | Trách nhiệm |
| --- | --- | --- |
| Router | [App.tsx](Frontend/src/App.tsx) | Public/protected routes và QueryClient |
| HTTP | [apiClient.ts](Frontend/src/api/apiClient.ts) | Gắn JWT, refresh queue, retry policy, unwrap response |
| Auth state | [useAuthStore.ts](Frontend/src/store/useAuthStore.ts) | Login/logout/profile và trạng thái khởi tạo |
| Study state | [useStudyStore.ts](Frontend/src/store/useStudyStore.ts) | Deck, quiz, batch answer, sync |
| Dashboard | [DashboardPage.tsx](Frontend/src/pages/Dashboard/DashboardPage.tsx) | Cursor pagination và load more |
| Query hooks | [useStudyQueries.ts](Frontend/src/hooks/useStudyQueries.ts) | TanStack Query hooks |
| Quiz UI | [QuizEngine.tsx](Frontend/src/components/study/QuizEngine.tsx) | Chọn option và tự chấm theo `isCorrect` |

### 5.3 Module đang là playground/legacy

- `Backend/src/modules/web/socket-io.gateway.ts`: Socket.IO gateway hiện tại; cần hoàn thiện auth/rate-limit trước khi dùng như kênh production.
- `PUT /api/v1/posts`: controller hiện chỉ trả `{}` và route chưa có auth; đây là placeholder, không phải feature hoàn chỉnh.
- Một số dependency SQL/MariaDB còn trong package nhưng persistence chính hiện là MongoDB.

Tech Lead cần đánh dấu rõ các module này để thành viên mới không tưởng chúng là production path.

---

## 6. Luồng sống của một HTTP request

Ví dụ: `GET /api/v1/sets?limit=20` với access token.

### Bước 1 — Nginx chặn rẻ ở biên

[nginx/default.conf](nginx/default.conf) thực hiện:

- Giới hạn API theo IP: `30 request/giây`, burst `60`.
- Giới hạn endpoint auth nghiêm ngặt hơn: `10 request/phút`, burst `5`.
- Tối đa `30` connection/IP.
- Trả `431` nếu Authorization header dài hơn 4096 ký tự.
- Duy trì upstream keep-alive để giảm chi phí TCP handshake.

Mục đích là loại traffic rác trước khi Node phải parse JSON hoặc chạy crypto JWT.

### Bước 2 — Nest/Fastify middleware và plugins chung

[main.ts](Backend/src/main.ts) cấu hình:

1. Helmet/security headers.
2. JSON và form parser, giới hạn `1mb`.
3. CORS allowlist.
4. Session/flash chỉ cho web routes cần session; JWT API không chạm Redis session.
5. Controllers/guards Nest xử lý routing, auth, rate limit, validation và abort signal.

### Bước 3 — API rate-limit guard

[ApiRateLimitGuard](Backend/src/common/guards/api.guards.ts) chạy trước handler ở các API controller có khai báo guard.

Rate limiter:

1. Kiểm tra Bearer token có hình dạng hợp lệ với chi phí rẻ.
2. Đọc principal từ JWT L1 hoặc verify chữ ký một lần.
3. Chọn identity `user:<id>` nếu token hợp lệ, nếu không dùng `ip:<address>`.
4. Gửi token-bucket `EVALSHA` và `EXISTS blacklist` trong cùng một Redis pipeline nếu có JTI.
5. Ghi kết quả vào `req.authContext` để auth middleware dùng lại.

### Bước 4 — Optional auth guard

`GET /sets` cho phép cả khách lẫn user. `OptionalJwtAuthGuard` trong [api.guards.ts](Backend/src/common/guards/api.guards.ts) dùng auth context đã có; không verify JWT lần thứ hai.

- Token tốt: gắn `req.user`.
- Không token/token lỗi: tiếp tục dưới danh nghĩa anonymous.
- Token đã logout: không gắn user.

### Bước 5 — Validation

Zod biến `limit` từ string thành number, mặc định 20, giới hạn 1–50; cursor phải là Mongo ObjectId 24 ký tự.

### Bước 6 — Controller và service

Controller chuyển `userId`, `cursor`, `limit`, `AbortSignal` vào `studyService.listSetsRaw()`.

Service:

1. Đọc version public và version của user.
2. Tạo cache key chứa scope, version, limit và cursor.
3. Thử L1, rồi L2 Redis.
4. Nếu miss, repository query MongoDB bằng cursor và `limit + 1`.
5. Serialize đúng response envelope một lần và cache raw JSON.

### Bước 7 — Response

Backend dùng dạng:

```json
{
  "obj": {
    "success": true,
    "data": {},
    "message": "..."
  }
}
```

Axios interceptor unwrap `obj.data`, nên component thường nhận thẳng dữ liệu domain.

---

## 7. Mô hình dữ liệu

```text
User 1 --- 0..1 Phone
User 1 --- N Post

User.id --(scalar userId)--> FlashcardSet 1 --- N Card
FlashcardSet 1 --- N StudySession
Card 1 --- N UserCardProgress

UserCardProgress unique(userId, cardId)
```

### 7.1 User

- Email unique.
- Password lưu hash bcrypt.
- `status` cho phép vô hiệu hóa user trong token payload.
- Phone là quan hệ một-một.

### 7.2 FlashcardSet

- Thuộc một `userId`.
- Có `isPublic` để điều khiển visibility.
- Cascade delete cards và study sessions thông qua relation.
- Hai compound index phục vụ cursor pagination:
  - `(isPublic, createdAt desc, id desc)` cho khách/public.
  - `(userId, createdAt desc, id desc)` cho dữ liệu theo owner.

### 7.3 Card

- Thuộc đúng một set.
- Có term, definition và metadata audio/example/image.
- Index `setId` để lấy cards của deck.

### 7.4 UserCardProgress

- Một bản ghi duy nhất trên cặp `(userId, cardId)`.
- Theo dõi streak, đúng/sai, trạng thái và ngày ôn tiếp theo.
- Index `(userId, nextReviewAt, status)` phù hợp cho use case “các thẻ đến hạn ôn”. UI/API cho use case này chưa hoàn chỉnh.

### 7.5 StudySession

- Lưu bản tóm tắt của phiên đã hoàn tất.
- ID được băm từ `userId + clientSessionId`, vì vậy cùng một retry hội tụ về một document.
- Đây là idempotency key bền vững mà không cần thêm field unique mới.

### 7.6 Lưu ý thiết kế dữ liệu

Một số quan hệ với User chỉ dùng scalar `userId`, không khai báo Prisma relation. Hệ quả:

- Linh hoạt hơn khi query nhưng mất referential behavior tự động.
- Xóa user có thể để lại deck/progress nếu service không dọn thủ công.
- Cần quyết định rõ chính sách data retention trước khi hoàn thiện delete-account.

---

## 8. Luồng xác thực và bảo mật token

### 8.1 Đăng nhập

```text
POST /auth/login
  -> Nginx auth limiter
  -> Redis global/auth limiter
  -> Zod validate
  -> tìm User theo email
  -> bcrypt verify password
  -> tạo access token + refresh token có JTI
  -> lưu refresh_token:<jti> vào Redis với TTL
  -> trả hai token
```

Frontend lưu hai token trong `localStorage`, gắn access token vào Authorization header.

### 8.2 Xác thực access token tối ưu

[accessToken.service.ts](Backend/src/services/accessToken.service.ts) có một cache JWT dùng chung cho rate limiter và auth:

- Chỉ cache token hợp lệ, không cache token lỗi do attacker kiểm soát.
- LRU tối đa mặc định 10.000 entry.
- TTL tối đa 60 giây nhưng luôn `min(TTL L1, exp của token)`.
- Entry hết hạn JWT bị loại ngay, không được “sống thêm” theo cache TTL.
- Trích xuất sẵn `user`, `jti`, `expiresAt`.

Trước crypto, token bị từ chối nếu:

- Authorization header quá 4096 byte.
- Không đúng `Bearer <token>`.
- Token ngắn hơn 64 hoặc dài hơn 4089 ký tự.
- Không đúng ba segment Base64URL.

Fast reject không chặn được token giả có hình dạng JWT chuẩn, nhưng loại phần lớn rác với chi phí regex/length rất nhỏ.

### 8.3 Blacklist và rate limit trong một RTT

Đối với token hợp lệ, middleware pipeline hai lệnh:

```text
EVALSHA token_bucket(...)
EXISTS blacklist_token:<jti>
```

`execAsPipeline()` giảm từ hai lượt chờ mạng Redis xuống một. Token bucket vẫn atomic vì bản thân nó là Lua script. Blacklist vẫn được hỏi Redis tập trung mỗi request nên logout có hiệu lực giữa nhiều Node instance.

### 8.4 Refresh-token rotation atomic

Khi refresh:

1. Verify chữ ký refresh token.
2. Lấy `jti` và `userId`.
3. `GETDEL refresh_token:<jti>`.
4. Chỉ request đầu tiên lấy được payload.
5. Tạo và lưu refresh token mới.

Phản ví dụ đã được xử lý: hai tab đồng thời dùng cùng refresh token. Với `GET` rồi `DEL`, cả hai có thể cùng pass; với `GETDEL`, đúng một request thắng.

Frontend cũng có `isRefreshing + failedQueue` để nhiều request 401 cùng lúc chỉ tạo một refresh request trong browser.

### 8.5 Logout

- Access-token JTI được ghi vào `blacklist_token:<jti>` với TTL bằng phần đời token còn lại.
- Raw access token bị evict khỏi JWT L1 của instance hiện tại.
- Các instance khác vẫn từ chối token vì blacklist Redis được kiểm tra mỗi request.

### 8.6 Quên mật khẩu

- Tạo random token 32 byte.
- Redis chỉ lưu SHA-256 của token trong 15 phút.
- Reset dùng `GETDEL`, nên token dùng một lần và chống hai request đồng thời.
- Endpoint forgot không tiết lộ email có tồn tại hay không.

### 8.7 Web EJS

Web server-rendered dùng session cookie:

- Session lưu Redis.
- Cookie `httpOnly`, `sameSite=lax`, `secure` trong production.
- CSRF synchronizer token và timing-safe comparison.

Đây là mô hình auth khác API JWT; không nên trộn logic hai mô hình.

---

## 9. Luồng flashcard và search

### 9.1 Danh sách deck

Anonymous nhận bộ public. User đăng nhập nhận:

```text
isPublic = true OR userId = currentUser
```

Kết quả chỉ gồm summary và `cardCount`, không kéo toàn bộ cards.

Cursor pagination sắp theo:

```text
createdAt DESC, id DESC
```

Repository lấy `limit + 1`; phần tử dư chỉ dùng xác định `hasMore`. `nextCursor` là ID cuối trang.

### 9.2 Tại sao cursor tốt hơn offset ở đây?

- Không phải skip qua hàng chục nghìn document.
- Ít bị trùng/mất item hơn khi có insert mới giữa hai lần tải.
- Cache từng page được vì key có cursor và limit.

Tuy nhiên cursor hiện chỉ chứa `id`, trong khi sort có cả `createdAt` và `id`. MongoDB cursor theo unique `id` vẫn định vị được document, nhưng contract pagination phụ thuộc document cursor còn tồn tại. Nếu item cursor bị xóa giữa hai trang, cần integration test/chiến lược composite cursor rõ hơn.

### 9.3 Chi tiết deck và quyền riêng tư

`getSetById()` cache object theo `setId + detailVersion`, sau đó kiểm tra:

```text
public OR set.userId == request.userId
```

Cache detail không bắt buộc chứa userId trong key vì object deck là cùng một object và authorization được kiểm tra **sau cache read, trước response**. Điều bắt buộc là không được cache “quyết định được phép” chung cho mọi user.

Danh sách deck thì khác: nội dung query phụ thuộc user, vì thế cache key bắt buộc chứa scope `user:<id>` hoặc `public`. Đây chính là lỗi cache leakage đã được sửa.

### 9.4 Create/update/delete

- Controller luôn lấy owner từ JWT, không tin `userId` trong body.
- Repository kiểm tra owner trước mutation.
- Update deck và cards chạy trong MongoDB transaction.
- Card ID gửi trong update phải thực sự thuộc deck; card ngoại lai bị từ chối.
- Sau commit, service tăng cache version liên quan và enqueue job search.

### 9.5 Search công khai

```text
GET /api/decks/public/search?q=...
  -> Elasticsearch ngram + lowercase + asciifolding
  -> filter isPublic=true
  -> sort score, updatedAt
```

Asciifolding giúp tìm kiếm không dấu. Nếu Elasticsearch lỗi, fallback Mongo chỉ chạy khi `ELASTICSEARCH_FALLBACK_TO_MONGO=true`; nếu không trả 503 để tránh âm thầm cung cấp chất lượng/hiệu năng khác contract.

### 9.6 Đồng bộ Elasticsearch ngoài request

```text
MongoDB commit
  -> enqueue BullMQ job
  -> trả HTTP response

Worker
  -> đọc trạng thái mới nhất từ MongoDB
  -> index nếu public
  -> delete khỏi index nếu private/đã xóa
```

Job retry tối đa 5 lần với exponential backoff. Worker concurrency mặc định 5.

`external_gte` version ngăn job cũ ghi đè mutation mới hơn. Nếu update A enqueue trước nhưng xử lý sau update B, version B thắng.

Giới hạn cần nhớ: đây là job queue sau commit, **chưa phải transactional outbox**. Nếu Mongo commit thành công nhưng Redis/BullMQ mất đúng lúc enqueue, API vẫn trả thành công và search có thể thiếu dữ liệu. Script [reindex-public-decks.ts](Backend/src/scripts/reindex-public-decks.ts) là đường phục hồi vận hành.

---

## 10. Luồng quiz và study session

### 10.1 Tạo quiz

1. Gọi `getSetById()` nên vẫn áp dụng visibility.
2. Lấy cards từ detail cache/MongoDB.
3. Shuffle, lấy tối đa `limit` câu.
4. Với mỗi card, lấy tối đa ba definition khác làm distractor ngay trong RAM.
5. Trả options có `isCorrect`.

Tối ưu quan trọng: không query N lần để lấy distractor cho N câu. Toàn bộ cards đã có trong RAM từ deck detail.

### 10.2 Client tự chấm

- Quiz UI đọc `chosenOption.isCorrect`.
- Write mode so sánh normalized input với term.
- Flashcard mode cho người dùng tự đánh dấu nhớ/chưa nhớ.
- Client gửi `{cardId, isCorrect}`.

Đây là trust model của self-study. Kết quả đo nỗ lực cá nhân, không phải bằng chứng khách quan.

### 10.3 Batch answer ở frontend

`useStudyStore` không gọi server sau từng click. Nó:

1. Cập nhật UI/counter ngay.
2. Thêm answer vào `pendingAnswers`.
3. Khi kết thúc, gửi một lần tới `/study/submit-answers`.
4. Sau đó gọi `/study/sync-progress`.

Kết quả: giảm số HTTP request, JWT check, Redis round-trip và contention theo session.

### 10.4 Atomic update trong Redis

Lua script trong [study.service.ts](Backend/src/services/study.service.ts):

- Đọc session JSON.
- Cập nhật correct/wrong count.
- Cập nhật streak/status/nextReview cho từng card.
- Ghi session với TTL 24 giờ.
- Thực hiện toàn bộ trong một Redis command atomic.

Nhiều Node instance submit đồng thời không còn lost update như mô hình `GET -> sửa trong Node -> SET`.

### 10.5 Sync Redis sang MongoDB

`syncProgress(userId, sessionId)`:

1. Giữ distributed lock cho đúng session.
2. Kiểm tra deterministic StudySession đã tồn tại chưa.
3. Nếu đã có, xóa Redis state còn sót và trả document cũ.
4. Nếu chưa, đọc Redis session.
5. Transaction upsert StudySession và bulk update toàn bộ UserCardProgress.
6. Chỉ sau commit mới xóa Redis session.

Nếu process crash sau Mongo commit nhưng trước Redis delete, lần retry thấy deterministic session và không tạo bản ghi trùng.

### 10.6 Submit và sync không được race

Sync giữ key `<sessionKey>:lock`. Lua submit kiểm tra lock này trước update và trả `409 STUDY_SESSION_BUSY`. Nhờ đó không có answer mới chen vào đúng lúc state đang được chuyển từ Redis sang MongoDB.

### 10.7 Điểm cần phản biện thêm

- `sync-progress` idempotent, nhưng gửi lại cùng batch answer không có answer-level idempotency key; retry không chắc chắn sau timeout có thể cộng đôi.
- `score = correctCount / số card duy nhất`. Nếu một card được trả lời đúng nhiều lần, score có thể vượt 100. Cần định nghĩa score theo lượt hay theo card cuối cùng.
- API nhận `cardId` nhưng chưa xác nhận card đó thuộc `setId` ngay tại submit. Với self-study, gian lận điểm không quan trọng, nhưng data integrity vẫn nên được định nghĩa.
- Session ID frontend dùng `Math.random + Date.now`, đủ cho UX thông thường nhưng `crypto.randomUUID()` rõ ràng và mạnh hơn.

---

## 11. Toàn bộ kiến thức cache áp dụng trong dự án

### 11.1 Cache là gì?

Cache giữ bản sao của dữ liệu để đổi lấy tốc độ. Ba câu hỏi luôn phải trả lời:

1. **Key là gì?** Mọi input làm thay đổi kết quả phải có mặt trong key.
2. **Bao giờ hết hạn?** TTL hay invalidation event.
3. **Ai là source of truth?** Cache không được tự trở thành dữ liệu chuẩn ngoài chủ đích.

Một cache nhanh nhưng key sai là lỗ hổng dữ liệu. Một cache hit 99% nhưng không invalidate được là hệ thống trả dữ liệu cũ rất hiệu quả.

### 11.2 Các lớp cache hiện có

| Cache | Vị trí | Dữ liệu | Phạm vi | TTL/giới hạn |
| --- | --- | --- | --- | --- |
| Browser Query cache | TanStack Query | Deck/API result | Một browser | stale 5 phút, GC 15 phút |
| Zustand/in-flight | Frontend RAM | Current deck/quiz/request | Một tab | Theo vòng đời app/request |
| JWT L1 | Node RAM | Token hợp lệ -> principal/JTI/exp | Một Node process | tối đa 60 giây, 10k entry, chặn theo exp |
| Data L1 | Node RAM | JSON/data domain | Một Node process | mặc định 5 giây, 1k entry, 32 MiB; SWR opt-in theo cache |
| Data L2 | Redis | Page/detail/query result | Dùng chung mọi Node | Theo từng cache, thường 5 phút/1 giờ |
| Elasticsearch | Search index | Projection deck public | Dùng chung | Eventual, cập nhật bởi job |

Elasticsearch là read model/index, không nên gọi đơn giản là cache vì nó có schema/search semantics riêng; tuy vậy nó vẫn là dữ liệu dẫn xuất từ MongoDB.

### 11.3 Cache-aside

Luồng chuẩn trong `cacheService.getOrSet*`:

```text
L1 hit -> trả
L1 miss -> Redis GET
L2 hit -> điền L1 -> trả
L2 miss -> gọi fetchFn MongoDB -> SET Redis -> điền L1 -> trả
```

Ưu điểm: chỉ cache dữ liệu thực sự được đọc. Nhược điểm: request đầu tiên chậm và có nguy cơ stampede.

### 11.4 Chống cache stampede

Dự án dùng hai lớp:

- `inFlight Map`: nhiều request trong cùng Node chờ chung một Promise.
- Redis fill lock `SET NX PX`: nhiều Node chỉ một instance query MongoDB; instance khác chờ L2 được điền.

Lock release dùng Lua “chỉ xóa nếu token đúng”, tránh xóa nhầm lock mới sau khi lock cũ hết TTL.

### 11.5 L1 bounded LRU

Data L1 bị giới hạn cả:

- Số entry.
- Tổng byte serialized.
- TTL rất ngắn.

Khi đầy, entry cũ nhất theo LRU bị loại. Jitter TTL giúp tránh hàng loạt key hết hạn đúng cùng millisecond.

Cache service hỗ trợ Stale-While-Revalidate theo từng lời gọi:

```text
L1 còn fresh -> trả ngay
L1 hết TTL nhưng còn trong stale window -> trả bản cũ ngay, khởi chạy một refresh nền dùng chung
Refresh nền: Redis hit -> cập nhật L1; Redis miss -> lấy nguồn dữ liệu, cập nhật Redis và L1
Hết stale window -> hard miss, caller chờ lần load bình thường
```

Hiện bật có chọn lọc cho trang danh sách deck (cache key có public/user version) và danh sách bài viết (cache key có `userId`): `SET_LIST_CACHE_SWR_MS=5000` và `POST_LIST_CACHE_SWR_MS=5000` mặc định, mỗi giá trị tối đa 60 giây. Nếu refresh lỗi, bản stale vẫn được trả đến hết cửa sổ SWR; retry nền có backoff mặc định một giây. SWR không bật cho tracker version hoặc cache detail deck có thể đổi visibility. Invalidation tường minh từ code/Pub/Sub vẫn xóa L1 ngay; fill đang chạy cũng bị đánh dấu để không ghi lại vào L1 sau khi invalidation đến.

### 11.6 Cross-instance invalidation

L1 chỉ thuộc một process. Khi Node A mutation, Node B không tự biết. `cacheService` publish message Redis Pub/Sub để mọi instance xóa L1 tương ứng.

Pub/Sub không durable; nếu Node mất message, TTL L1 5 giây là safety net. Vì thế L1 phải ngắn và Redis L2 mới là cache dùng chung.

### 11.7 Versioned cache key

Thay vì scan và xóa mọi page của danh sách, dự án tăng version:

```text
cache:version:sets:public = 42
sets:list:...:public-v42:limit:20:cursor:first
```

Sau create/update/delete public deck:

```text
INCR cache:version:sets:public
```

Request mới dùng `v43`, không còn nhìn thấy page v42. Key cũ tự hết TTL.

Ưu điểm:

- Invalidation O(1), không quét keyspace.
- Ít race giữa fill và delete.
- Dễ tách version public, version user, version detail.

Chi phí: key cũ tồn tại đến TTL và tốn Redis memory tạm thời.

### 11.8 Exact tag set thay cho SCAN

Với cache generic có tag, Redis giữ:

```text
tag:<tagName> = Set(cacheKey1, cacheKey2, ...)
```

Invalidation Lua làm `SMEMBERS` đúng các set, rồi `UNLINK` cache key và tag key trong một command. Nó không `SCAN` toàn Redis.

`deletePattern()` vẫn dùng `SCAN` như utility fallback, nhưng đường mutation deck và `invalidateTag()` chính không còn quét toàn keyspace.

### 11.9 Cache isolation theo user

Quy tắc:

```text
Nếu output phụ thuộc identity/quyền của user,
key phải chứa identity/quyền HOẶC authorization phải được kiểm lại trước response.
```

Ví dụ đã sửa:

- Posts: `...:user_<userId>:list_v<version>`.
- List sets: `scope=user:<userId>` hoặc `scope=public`.
- Detail set: dùng key chung được vì kiểm visibility sau cache read.

Phản ví dụ nguy hiểm:

```text
GET /posts của A -> cache key posts:list
GET /posts của B -> hit cùng key -> trả posts A
```

### 11.10 Vì sao không cache invalid JWT?

Attacker có thể gửi vô hạn token ngẫu nhiên. Nếu mỗi token lỗi được lưu:

- Cache đạt trần nhanh.
- Token thật bị evict.
- Node phải verify lại token thật thường xuyên.
- Tạo cache pollution/eviction storm.

Giải pháp hiện tại là positive-only cache. Token rác không chiếm RAM dài hạn. Nginx/IP limiter và fast-shape reject chịu trách nhiệm giảm CPU cho token lỗi.

### 11.11 Khi nào dùng cache nào?

| Tình huống | Nên dùng | Tại sao |
| --- | --- | --- |
| Token hợp lệ được dùng liên tục trong một Node | JWT L1 | Tránh lặp crypto; dữ liệu nhỏ; bounded theo exp |
| Detail/list được nhiều Node đọc | Redis L2 + L1 ngắn | Chia sẻ hit, giảm Mongo, vẫn nhanh trong process |
| Query phụ thuộc user | Key có user/scope | Ngăn data leakage |
| Danh sách có nhiều page | Versioned key | Invalidate O(1) |
| Nhóm key biết chính xác | Redis tag Set | Xóa chính xác, không SCAN |
| Search text/fuzzy/ngram | Elasticsearch | Database/cache key-value không thay thế inverted index |
| Counter/quota cập nhật đồng thời | Redis atomic/Lua, không JSON cache | Cần correctness dưới concurrency |
| Dữ liệu tài chính/điểm thi chính thức | DB/transaction, cache chỉ read | Không tin cache hoặc client làm nguồn chuẩn |

### 11.12 Khi không nên cache

- Kết quả lỗi do input attacker tạo ra mà keyspace vô hạn.
- Dữ liệu rất ít được đọc lại.
- Dữ liệu đổi liên tục nhưng không có invalidation đáng tin.
- Object quá lớn vượt lợi ích network/serialization.
- Quyết định authorization nếu key không gắn principal/policy version.

---

## 12. Concurrency và distributed systems

### 12.1 Atomicity không giống transaction toàn hệ thống

- Redis Lua atomic trong Redis.
- Mongo transaction atomic trong MongoDB.
- BullMQ enqueue atomic trong Redis.
- Nhưng Mongo commit + BullMQ enqueue không cùng một transaction. Đây là dual-write gap.

### 12.2 Những race condition đã được xử lý

| Race | Cơ chế |
| --- | --- |
| Hai refresh cùng token | Redis `GETDEL` |
| Hai reset-password cùng token | Redis `GETDEL` |
| N request update cùng study session | Một Lua script atomic |
| Submit chen vào lúc sync | Session lock + Lua check lock |
| Retry sync sau crash | Deterministic Mongo StudySession ID |
| N request cache miss cùng Node | Promise single-flight |
| N Node cache miss | Redis fill lock |
| Job ES cũ chạy sau job mới | External versioning |
| N request 401 trong browser | Refresh request queue |

### 12.3 Failure mode rate limiter

- Global/heavy limiter mặc định fail-open: Redis lỗi thì ưu tiên availability.
- Sensitive auth limiter fail-closed: không xác định identity/Redis lỗi thì trả 503.

Đây là trade-off đúng hướng: login/reset là bề mặt brute force nên security quan trọng hơn availability; read API thông thường có thể ưu tiên phục vụ.

### 12.4 Timeout và graceful shutdown

- Redis command/connect timeout có cấu hình.
- HTTP keep-alive của Node lớn hơn Nginx upstream keep-alive để tránh socket reuse đúng lúc Node đóng.
- SIGTERM/SIGINT dừng nhận HTTP, đóng Socket.IO, scheduler, worker, queue, Prisma, BullMQ và Redis theo thứ tự.
- Có force-exit 15 giây để deploy không treo vô hạn.

---

## 13. Các tối ưu đã thực hiện: nguyên nhân, giải pháp, kết quả

| Trước tối ưu | Vấn đề | Cách hiện tại | Kết quả kỹ thuật |
| --- | --- | --- | --- |
| Cache invalid JWT với `undefined` | Cache poisoning, evict token thật | Positive-only bounded JWT L1 | Token rác không chiếm L1; token thật tái sử dụng verify result |
| Hai JWT cache riêng | Verify trùng, logic exp khác nhau | Một `accessToken.service` dùng chung | Một principal/request, một policy LRU/exp |
| Rate limit và blacklist hai Redis RTT | Tăng latency mỗi request auth | `execAsPipeline()` EVALSHA + EXISTS | Một network batch; vẫn giữ Lua atomic và blacklist tập trung |
| Chỉ rate limit trong Node | Token rác vẫn tiêu CPU/socket Node | Nginx rate/conn limit + 431 guard | Loại traffic sớm trước Fastify/JWT |
| List posts không có user trong key | Có thể trả dữ liệu A cho B | Cache key chứa `userId` | Isolation theo người dùng |
| `GET /sets` trả toàn bộ | RAM/JSON/network/sort tăng theo dữ liệu | Cursor pagination 20 mặc định, max 50 | Response bị chặn kích thước; query theo index; cache từng page |
| Cache list không đủ scope | Public/private hoặc user chéo nhau | Scope public/user + version | Không dùng chung page sai quyền |
| Invalidation `SCAN` toàn Redis | Mutation chậm theo toàn keyspace | Version `INCR` và exact tag Set | Invalidation O(1) theo version hoặc O(số key của tag) |
| L1 TTL hết hạn phải chờ Redis | Tăng latency một lượt Redis ở request đầu sau TTL | SWR opt-in cho cache owner-scoped, có cửa sổ stale hữu hạn và refresh single-flight | Request stale trả ngay; request sau dùng L1 mới; invalidation tường minh vẫn hard delete |
| ES sync nằm trong write request | ES chậm kéo API chậm/theo | BullMQ worker, retry/backoff | Mongo write response không chờ ES; search eventual |
| GET–sửa–SET study JSON | Lost update khi concurrent | Redis Lua atomic, batch API | Một Redis RTT/batch, counter không mất update |
| Nhiều Prisma upsert/card | Nhiều round-trip DB | Mongo bulk command trong transaction | Một bulk update cho progress batch |
| Sync retry tạo nhiều session | Duplicate StudySession | Deterministic ID + upsert | Retry hội tụ cùng document |
| Refresh GET rồi delete | Double rotation | `GETDEL` | Chỉ một concurrent request thành công |
| Mọi API dùng web session | Redis I/O không cần thiết | Nạp Redis session trong WebSessionGuard | JWT API không load/save web session |
| Mỗi quiz question query distractor | N+1 query | Chọn distractor từ cards đã load | Không có N query phụ |
| L1 mỗi Node không biết mutation nơi khác | Dữ liệu stale giữa instance | Redis Pub/Sub invalidation + TTL ngắn | Invalidation nhanh, TTL làm fallback |
| Cache miss đồng loạt | Thundering herd MongoDB | Local single-flight + distributed fill lock | Một fetch chính trên cùng key |
| Retry mọi lỗi phía frontend | 429 càng bị retry càng quá tải | Chỉ retry 408/5xx, có jitter | Không tự khuếch đại rate-limit traffic |

### 13.1 Kết quả kiểm thử đã quan sát

Lần chạy kiểm chứng hiện tại ngày **2026-10-08**, bằng `npm run test:product` trên stack local:

- Lệnh chuẩn `npm run test:product` pass: **15/15 product subtest** (16/16 theo TAP nếu tính suite cha), gồm backend typecheck/build và frontend build.
- Test `GET /api/v1/sets` qua Nginx gửi **1.000 request với concurrency 50**. Subtest tải pass: **1.513,57 request/giây**, `p50 = 30,94 ms`, `p95 = 52,13 ms`, `p99 = 72,56 ms`; cả 1.000 response đều là HTTP 200.
- Benchmark phụ ngắn với 100 request, concurrency 10: Node trực tiếp, auth + warm cache đạt **1.963,74 request/giây**; Nginx, auth + warm cache đạt **1.267,92 request/giây**; Nginx, anonymous + warm cache đạt **1.048,90 request/giây**. Chỉ nên xem là số tham khảo.
- Khi bơm 60 ms latency một chiều qua proxy, `p50 = 127,33 ms`.
- Nginx phân phối request qua cả hai Node; khi dừng Node 1, **80/80** request hội tụ thành công và các request ổn định tiếp theo được phục vụ bởi Node 2.

Đây là một lần đo trên máy local, không phải SLA hay benchmark ổn định. Số liệu thay đổi theo CPU, Docker, cache, network và dataset.

### 13.2 Đối chiếu các claim hiệu năng và công nghệ

| Claim | Đối chiếu code/test | Kết luận |
| --- | --- | --- |
| React 19, TypeScript, Node.js, MongoDB 7 replica set, Redis, Elasticsearch 8, BullMQ, Nginx, Docker | Các dependency và cấu hình tương ứng có trong repo. API dùng **NestJS + Fastify**, không phải Express. Replica set trong compose hiện chỉ có một member. | Stack cơ bản đúng nếu sửa “Express” thành “NestJS + Fastify” và mô tả replica set là cấu hình local một member. |
| Token Bucket Lua và Nginx keep-alive | Có Lua token bucket trong Redis và upstream keep-alive trong Nginx. | Tính năng được triển khai; chưa có baseline trước/sau để quy kết mức tăng throughput cho chúng. |
| Ngưỡng pass của HTTP load test | Mặc định test chỉ yêu cầu tối thiểu 50 req/s và p99 không quá 2.000 ms. | Đây là smoke/performance check lỏng, không phải benchmark gate cho 4.290 req/s hay p97.5. |
| Tăng 189% từ 1.483 lên 4.290 req/s | Repo không lưu kết quả đo tái lập cho cả hai mốc. Lần kiểm chứng hiện tại đo 1.513,57 req/s ở 1.000 request, concurrency 50. Phép tính 1.483 → 4.290 tương đương tăng khoảng 189%, nhưng hai mốc chưa được xác minh. | Chưa đủ bằng chứng để ghi như kết quả đã đạt. |
| Giảm p97.5 latency 87% | Test ghi `p50`, `p95`, `p99`, không ghi `p97.5`; cũng không có cặp số trước/sau. | Chưa xác minh. |
| Không timeout ở 1.000 concurrent connections | Product test dùng concurrency 50 cho HTTP load; không có kịch bản 1.000 concurrent connections. | Chưa xác minh. Không suy rộng kết quả 1.000 request thành 1.000 kết nối đồng thời. |
| L1 LRU + L2 Redis, single-flight, distributed fill lock, Pub/Sub và versioned invalidation | Các cơ chế này có trong `cache.service.ts` và luồng cache danh sách. Version bump tránh scan keyspace O(1); invalidation tag vẫn phụ thuộc số key thuộc tag. | Được triển khai. Nên giới hạn claim O(1) cho đường invalidation bằng version. |
| BullMQ + Elasticsearch, diacritic-insensitive search, `external_gte` | Có queue/worker, analyzer `asciifolding` và `external_gte`. Analyzer dùng tokenizer `ngram` (không phải `edge_ngram`). Test xác nhận luồng index/search hoạt động nhưng không đặt ngưỡng latency tìm kiếm. | Pipeline và tìm kiếm không dấu được triển khai; “edge n-gram” và “sub-second” chưa được xác nhận bởi code/test hiện tại. |

### 13.3 Điều có thể kết luận và không thể kết luận

Lần đo hiện tại xác nhận route đọc danh sách bộ thẻ trả 1.000 response thành công ở concurrency 50 trong môi trường local. Test search cũng xác nhận deck được đưa qua BullMQ vào Elasticsearch và có thể tìm thấy.

Chưa thể kết luận:

- Các mức 4.290 req/s, giảm p97.5 87%, hoặc không timeout ở 1.000 kết nối đồng thời.
- Tìm kiếm có latency dưới một giây; test hiện tại kiểm tra kết quả, không đo SLA latency search.
- Product test hiện xác nhận Nginx đã gửi request tới cả hai Node và failover thành công trong môi trường local; đây chưa phải bằng chứng cho SLA failover production.
- Cùng RPS trên cloud production, không có bottleneck khi dữ liệu lớn, hoặc p99 production bằng p99 local.
- Hệ thống đạt high availability khi Redis/Mongo chỉ có một node thực tế.

---

## 14. Kiểm thử và CI

### 14.1 Test pyramid hiện tại

| Loại | Nội dung |
| --- | --- |
| Unit | JWT cache/fast reject, validator, error middleware, abort signal |
| Mock integration | Auth refresh atomic, post cache isolation, sync idempotency |
| Redis integration | TTL, GETDEL, cache single-flight/tag, Lua study, token bucket, NOSCRIPT reload, pipeline |
| Redis load | Parallel SET/GET và Lua token bucket, đo percentile |
| Product stack | Frontend build, HTTP auth, cache privacy, pagination, ES job, study race, two Node, Nginx load/latency/edge/failover |

### 14.2 Lệnh test

Chạy trong `Backend`:

```bash
npm test
npm run test:integration
npm run test:redis
npm run test:redis:load
npm run test:product
npm run test:all
```

`test:all` chạy lint backend, lint frontend, test thường, Redis load và product stack.

### 14.3 CI

[product-tests.yml](.github/workflows/product-tests.yml) chạy trên push `main/master` và pull request:

1. Node 22.
2. Cài Redis test binary.
3. `npm ci` hai workspace.
4. `npm run test:all`.
5. Luôn teardown product-test containers.

### 14.4 Test còn thiếu

- Contract/API schema snapshot hoặc OpenAPI validation.
- Test delete-account và cascade/data-retention.
- Test answer-batch replay/idempotency.
- Test pagination khi cursor document vừa bị xóa.
- Test queue enqueue thất bại đúng crash window.
- Chaos test Redis failover/Mongo primary election thật.
- Browser E2E cho login → create deck → học → refresh page.
- Security test cho WebSocket nếu module được giữ.

---

## 15. Câu hỏi nghiệp vụ và phản ví dụ cần Product Owner trả lời

Một Tech Lead không chỉ hỏi “code có chạy không?”, mà phải hỏi “quy tắc có đúng không?”. Mỗi mục dưới đây có câu hỏi, phản ví dụ và quyết định cần chốt.

### 15.1 Dashboard hiển thị gì?

**Câu hỏi:** Dashboard là “bộ của tôi” hay “feed gồm public + bộ của tôi”?  
**Hiện tại:** API trả mọi public deck cộng private deck của user, trong khi UI ghi “Bộ thẻ từ vựng của bạn”.  
**Phản ví dụ:** User mới chưa tạo deck nhưng thấy 20 public deck; thống kê “Bộ thẻ = 20” khiến họ tưởng là của mình.  
**Cần chốt:** Tách endpoint/tab `mine`, `discover`, hay đổi wording UI.

### 15.2 Điểm số có đáng tin không?

**Câu hỏi:** Điểm chỉ để tự xem hay dùng leaderboard/chứng chỉ/phần thưởng?  
**Phản ví dụ:** Người dùng gọi API trực tiếp và gửi tất cả `isCorrect=true`.  
**Cần chốt:** Nếu self-study, giữ client trust và ghi rõ “self-reported”. Nếu có giá trị bên ngoài, server phải nhận answer, tự đối chiếu đáp án và không trả `isCorrect` trước.

### 15.3 Một card được trả lời nhiều lần tính thế nào?

**Câu hỏi:** Score theo số lượt trả lời, số card duy nhất, hay trạng thái cuối?  
**Phản ví dụ:** Một session có 10 card; user trả lời đúng card đầu 20 lần, score hiện có thể vượt 100%.  
**Cần chốt:** Công thức score và invariant `0 <= score <= 100`.

### 15.4 Retry answer có được cộng hai lần?

**Câu hỏi:** Client timeout rồi gửi lại cùng batch thì đó là replay hay lượt học mới?  
**Phản ví dụ:** Redis đã ghi batch nhưng response rơi; client retry và counter tăng đôi.  
**Cần chốt:** Thêm `submissionId` idempotency cho mỗi batch, hoặc chấp nhận at-least-once và UI không tự retry mutation.

### 15.5 Card có bắt buộc thuộc set/session không?

**Câu hỏi:** Tiến trình chỉ được ghi cho card trong deck đang học?  
**Phản ví dụ:** Request khai `setId=A` nhưng gửi `cardId` của deck B.  
**Cần chốt:** Validate membership tại start session hoặc submit; có thể cache danh sách card IDs để giảm DB.

### 15.6 Deck thay đổi trong lúc đang học

**Câu hỏi:** Session dùng snapshot hay deck live?  
**Phản ví dụ:** Chủ deck xóa card khi user khác đang học; đến sync, progress trỏ tới card đã mất.  
**Cần chốt:** Snapshot version cho session, gracefully ignore deleted card, hay khóa mutation.

### 15.7 Chuyển public thành private

**Câu hỏi:** Search phải biến mất trong bao lâu?  
**Phản ví dụ:** Mongo đã private nhưng job ES chưa chạy; search vẫn trả projection public. Sau đó detail API trả 404 nên không lộ card, nhưng title/author vẫn có thể lộ tạm thời.  
**Cần chốt:** SLA eventual consistency; với privacy-sensitive transition có cần synchronous delete/tombstone ưu tiên không.

### 15.8 Xóa user

**Câu hỏi:** Xóa thật, soft-delete hay anonymize? Deck public của user xử lý thế nào?  
**Phản ví dụ:** Xóa user nhưng scalar `userId` trong deck/progress còn lại, Elasticsearch vẫn ghi author cũ.  
**Cần chốt:** Retention, cascade, ownership transfer, audit và right-to-erasure.

### 15.9 Cùng IP ở trường học/công ty

**Câu hỏi:** Auth rate limit theo IP có làm nhiều user sau NAT chặn nhau không?  
**Phản ví dụ:** 100 học sinh dùng chung Wi-Fi đăng nhập đầu giờ; zone 10r/m chặn phần lớn.  
**Cần chốt:** Rate theo IP + account/email hash, challenge, adaptive limit hoặc allowlist tổ chức.

### 15.10 Offline learning

**Câu hỏi:** Người dùng có cần học offline và sync sau không?  
**Phản ví dụ:** Tab bị đóng trước `syncProgress`; Redis giữ 24 giờ rồi mất.  
**Cần chốt:** IndexedDB outbox phía client, background sync, resume session và conflict rule.

### 15.11 Quy mô deck

**Câu hỏi:** Một deck tối đa bao nhiêu card và media bao nhiêu MB?  
**Hiện tại:** Update tối đa 500 card, bulk add tối đa 200, nhưng create không có max số card tương ứng trong validator.  
**Phản ví dụ:** Create request chứa hàng chục nghìn card dưới giới hạn JSON 1 MB hoặc chuỗi example rất lớn.  
**Cần chốt:** Limit đồng nhất và upload media qua object storage, không truyền blob trong JSON.

### 15.12 Search semantics

**Câu hỏi:** Search chỉ title hay cả description/card term/author? Có cần tiếng Việt có dấu, typo tolerance, popularity?  
**Phản ví dụ:** User tìm một từ nằm trong card nhưng title không chứa từ đó nên không có kết quả.  
**Cần chốt:** Search document và ranking contract trước khi mở rộng mapping.

### 15.13 Quyền chỉnh sửa cộng tác

**Câu hỏi:** Deck chỉ có một owner hay hỗ trợ collaborator/classroom?  
**Phản ví dụ:** Giáo viên muốn học sinh cùng bổ sung card nhưng ownership check hiện chỉ cho đúng một `userId`.  
**Cần chốt:** ACL/role per-deck thay vì nhét ngoại lệ vào middleware.

### 15.14 Refresh token và thiết bị

**Câu hỏi:** Có quản lý nhiều thiết bị, “logout all”, danh sách session không?  
**Phản ví dụ:** User đổi mật khẩu nhưng refresh token trên máy bị mất vẫn có thể còn hiệu lực.  
**Cần chốt:** Token family, device/session record, reuse detection và revoke-all version.

### 15.15 Moderation public content

**Câu hỏi:** Ai chịu trách nhiệm nội dung xấu/bản quyền trong public deck?  
**Phản ví dụ:** Public search index phát tán nội dung bị báo cáo nhưng hệ thống không có report/moderation status.  
**Cần chốt:** Draft/published/blocked state, report workflow, audit log.

---

## 16. Review bảo mật và resilience

### 16.1 Các lớp bảo vệ hiện có

- Nginx rate limit, connection limit, header-size guard.
- Node token bucket Redis dùng TIME chung giữa instance.
- Auth endpoint fail-closed.
- JWT signature, exp, JTI, blacklist.
- Positive-only bounded JWT cache.
- Refresh/reset token single-use atomic.
- Bcrypt password hashing.
- Zod validation và giới hạn batch.
- Ownership check trong repository cho deck mutation.
- Private deck trả 404.
- CORS allowlist; production bắt buộc cấu hình origins.
- Helmet CSP/HSTS phù hợp môi trường.
- Web session cookie bảo vệ và CSRF.
- Body limit 1 MB.
- Graceful shutdown.

### 16.2 Rủi ro còn lại nên ưu tiên

#### P0 nếu bật WebSocket ra Internet

`socket-server.ts` đang chấp nhận connection/event mà không auth hay rate limit; payload được log và broadcast. Phải tắt module hoặc bổ sung:

- Handshake auth dùng access-token service + Redis blacklist.
- Origin allowlist.
- Per-socket/IP/user rate limit.
- Schema và size limit cho mọi event.
- Room authorization.
- Không log payload tùy ý.
- Redis adapter nếu chạy nhiều Socket.IO instance.

#### P1 — Token trong localStorage

XSS có thể đọc access/refresh token. Hướng production phổ biến:

- Access token ngắn hạn giữ memory.
- Refresh token trong `HttpOnly Secure SameSite` cookie.
- CSRF strategy phù hợp cho refresh endpoint.
- CSP nghiêm hơn và loại inline script khi có thể.

#### P1 — Queue dual-write gap

Chuyển sang transactional outbox trong MongoDB:

```text
Mongo transaction: mutation + outbox event
Outbox dispatcher: event -> BullMQ/ES -> mark delivered
```

#### P1 — Answer replay/data integrity

Thêm submission idempotency và validate card membership nếu progress trở thành dữ liệu quan trọng.

#### P1 — Production topology

Compose hiện là local/dev:

- Redis một node dù có AOF.
- Mongo replica set chỉ một data-bearing member.
- Elasticsearch single-node và security tắt.
- Mongo Express expose port và credential mẫu.
- Root Nginx upstream chỉ một backend host.

Không được sao chép nguyên cấu hình này ra Internet.

#### P2 — API consistency

- `PUT /posts` là route placeholder không auth.
- Error response và success response có envelope khác nhau.
- `any` còn ở controller/store.
- Comment trong frontend nói PostgreSQL dù dự án dùng MongoDB.
- Users service có relation allowlist mang dấu vết domain cũ.

---

## 17. Observability cần bổ sung

Hiện có console log/warn/error và Morgan ở development, nhưng chưa đủ vận hành production.

Nên có:

- Structured JSON logs với `requestId`, userId đã mask, route, status, latency.
- Metrics Prometheus/OpenTelemetry:
  - HTTP RPS/error/p50/p95/p99.
  - Rate-limit rejects theo namespace.
  - JWT L1 hit/miss/eviction.
  - Data L1/L2 hit ratio và fill-lock wait.
  - Redis command latency/error.
  - Mongo query latency/transaction abort.
  - BullMQ waiting/active/failed/age.
  - Elasticsearch indexing lag/search error.
  - Study sync 409/retry/idempotent hit.
- Distributed tracing từ Nginx/request tới Mongo/Redis/ES/job.
- Alert theo SLO, không chỉ theo CPU.
- Dead-letter/replay dashboard cho search job.

Không có metrics thì không thể chứng minh cache “tối ưu bao nhiêu” trong production; chỉ có thể suy luận từ benchmark.

---

## 18. Roadmap kỹ thuật đề xuất

### Giai đoạn 1 — Làm sạch correctness và product contract

1. Chốt Dashboard là mine hay discover.
2. Chốt công thức score và giới hạn 0–100.
3. Thêm `submissionId` cho answer batch.
4. Validate `cardId` thuộc session/set.
5. Hoàn thiện hoặc xóa `PUT /posts` placeholder.
6. Tắt Socket.IO demo theo default nếu chưa làm security.

### Giai đoạn 2 — Reliability production

1. Transactional outbox cho search indexing.
2. Tách search worker thành process/deployment riêng.
3. Redis HA, Mongo replica thật, Elasticsearch có auth/TLS.
4. Health/readiness endpoint kiểm tra có phân loại dependency.
5. Metrics, tracing, structured logging và alert.
6. Browser E2E và chaos/failover test.

### Giai đoạn 3 — Product growth

1. Spaced-repetition queue từ `nextReviewAt`.
2. Resume/offline session.
3. Classroom/collaboration ACL nếu nghiệp vụ cần.
4. Search card term/author và ranking.
5. Moderation/report public deck.
6. Device sessions/logout-all.

### Giai đoạn 4 — Scale khi có bằng chứng cần thiết

- Chỉ shard/partition sau khi metrics chỉ ra bottleneck.
- Cache thêm khi hit ratio và DB load chứng minh lợi ích.
- Không microservice hóa chỉ để “trông production”; domain hiện tại vẫn phù hợp modular monolith + worker.

---

## 19. Runbook chạy và vận hành

### 19.1 Chạy local

```bash
docker compose up -d

cd Backend
cp .env.example .env
npm ci
npm run dev

cd ../Frontend
npm ci
npm run dev
```

Kiểm tra:

- Frontend: `http://localhost:5500`
- Backend: `http://localhost:3000`
- Nginx: `http://localhost:80`
- Mongo Express local: `http://localhost:8081`
- Elasticsearch: `http://localhost:9200`

### 19.2 Sau khi đổi Prisma schema/index

Đảm bảo schema được apply/generate theo workflow của dự án trước deploy. MongoDB cần thực sự có compound index, không chỉ có khai báo trong file Prisma.

### 19.3 Reindex search

```bash
cd Backend
npm run search:reindex
```

Dùng khi:

- Tạo index lần đầu.
- Queue outage làm lỡ event.
- Đổi mapping/index version.
- Audit thấy Mongo và Elasticsearch lệch nhau.

### 19.4 Biến môi trường quan trọng

| Nhóm | Biến |
| --- | --- |
| Runtime | `NODE_ENV`, `PORT`, `CORS_ALLOWED_ORIGINS`, `TRUST_PROXY` |
| Secrets | `SESSION_SECRET`, `JWT_SECRET`, `JWT_REFRESH_SECRET` |
| Mongo | `DATABASE_URL` |
| Redis | `REDIS_URL` hoặc host/port, command/connect timeout |
| JWT L1 | TTL, max entries, token/header length |
| Data L1 | TTL, max entries, max bytes, fill-lock timeout |
| Rate limit | global/auth/heavy max/window/refill/capacity |
| Study | session lock TTL/wait |
| Search | ES URL/auth/index, worker enable/concurrency, fallback flag |
| Scheduler | enable, cron, recipient |

### 19.5 Quy tắc deploy

- Secret production phải khác mẫu và đủ mạnh.
- `TRUST_PROXY` chỉ tin proxy/hop cụ thể; không dùng `true` mù quáng.
- Ít nhất một search worker phải chạy nếu write API enqueue job.
- Nginx và Node timeout phải tương thích.
- Deploy graceful để request/job đang chạy được drain.
- Thay đổi cache key/schema nên bump version hoặc có kế hoạch migration.
- Thay mapping Elasticsearch nên tạo index version mới và reindex/swap alias trong hệ lớn.

---

## 20. Runbook chẩn đoán theo triệu chứng

### API bỗng chậm

1. So sánh direct Node với Nginx.
2. So sánh anonymous với authenticated.
3. Kiểm tra Redis latency/timeout và reconnect.
4. Kiểm tra L1/L2 hit ratio; có cache stampede không.
5. Kiểm tra Mongo query plan và compound index.
6. Kiểm tra response/page size.
7. Kiểm tra event loop/CPU do JWT, JSON serialize hoặc logging.

### User thấy deck cũ

1. Kiểm tra mutation đã tăng đúng public/user/detail tracker chưa.
2. Đọc cache key version mới.
3. Kiểm tra Pub/Sub subscriber của các Node.
4. Chờ tối đa L1 TTL để phân biệt L1 stale và L2 stale.
5. Kiểm tra browser TanStack Query/Zustand cache.

### Search không thấy deck vừa tạo

1. Xác nhận Mongo deck là public.
2. Kiểm tra BullMQ waiting/failed job.
3. Kiểm tra worker có bật không.
4. Kiểm tra ES index/mapping/version conflict.
5. Nếu event bị lỡ, chạy reindex.

### Sync progress trả 404

1. Session có bị quá TTL 24 giờ không.
2. Frontend có gọi `startNewSession(setId, mode)` đúng chưa.
3. Batch answers có thực sự gửi thành công trước sync không.
4. Session đã sync trước đó chưa; deterministic document có tồn tại không.

### Nhiều 401 cùng lúc

1. Access token hết hạn hay blacklist.
2. Refresh token có bị dùng ở tab khác và rotation không.
3. Browser refresh queue có tạo đúng một request không.
4. Clock giữa issuer/host.
5. Secret access/refresh giữa Node instance có đồng nhất không.

### Nhiều 429

1. 429 từ Nginx hay Node/Redis dựa vào response/header/log.
2. Có NAT nhiều user chung IP không.
3. Frontend có retry 429 không; hiện query policy không retry.
4. Bucket identity là user hay IP.
5. Thông số production có phù hợp traffic thật không.

---

## 21. Bài tập học dự án như một kỹ sư senior

### Bài 1 — Trace một request

Chọn `PUT /api/v1/sets/:id`, ghi lại:

- Middleware đi qua.
- Identity lấy từ đâu.
- Ownership kiểm ở đâu.
- Mongo transaction thay đổi gì.
- Cache version nào tăng.
- Job nào được enqueue.
- Search stale trong khoảng nào.

### Bài 2 — Chứng minh cache isolation

Tạo user A/B:

1. A tạo private deck/post.
2. Làm nóng cache bằng request A.
3. B gọi cùng endpoint trên Node khác.
4. Chứng minh B không nhận dữ liệu A.
5. Chỉ ra phần cache key hoặc authorization check tạo invariant đó.

### Bài 3 — Mô phỏng race

- Gửi hai refresh request cùng token và chứng minh chỉ một thành công.
- Gửi 300 answer song song và kiểm counter.
- Gọi sync hai lần và kiểm một StudySession.
- `SCRIPT FLUSH` rồi gọi rate limiter để xem NOSCRIPT reload.

### Bài 4 — Thiết kế answer idempotency

Đề xuất payload:

```json
{
  "sessionId": "...",
  "submissionId": "uuid",
  "answers": []
}
```

Hãy quyết định:

- Redis lưu submission ID bao lâu.
- Lua trả lại result cũ hay chỉ no-op.
- Làm sao không tăng RAM vô hạn.
- Khi nào submission được xóa sau sync.

### Bài 5 — Thiết kế transactional outbox

Vẽ schema OutboxEvent, transaction tạo deck + event, dispatcher claim/retry và cách bảo đảm consumer idempotent.

---

## 22. Checklist review pull request

### Nghiệp vụ

- Quy tắc mới đã có ví dụ và phản ví dụ chưa?
- Client có đang được tin ở chỗ không phù hợp không?
- Public/private/owner/collaborator có rõ không?

### API

- Input có Zod schema, size/max và coercion rõ chưa?
- Status code/error envelope nhất quán chưa?
- Endpoint list có pagination chưa?
- Mutation có idempotency khi client retry không?

### Auth và authorization

- Identity lấy từ token, không từ body?
- Ownership kiểm ở lớp không thể bị bỏ qua?
- Cache key/quyết định auth có principal scope?
- Sensitive failure mode nên open hay closed?

### Cache

- Key chứa tất cả input ảnh hưởng output?
- TTL và invalidation event là gì?
- Multi-instance invalidation thế nào?
- Cache miss đồng thời có stampede không?
- Entry có bounded theo count/bytes/exp không?

### Concurrency

- Có read-modify-write race không?
- Atomic boundary nằm ở Redis, Mongo hay cả hai?
- Crash giữa hai hệ thống để lại trạng thái gì?
- Retry tạo duplicate hay hội tụ?

### Performance

- Có N+1 query không?
- Response có bị không giới hạn không?
- Có network round-trip gộp được không?
- Tối ưu có benchmark trước/sau hay ít nhất test invariant không?

### Vận hành

- Có log/metric để biết feature hỏng không?
- Worker/scheduler có graceful shutdown không?
- Có recovery path/reindex/replay không?
- CI có exercise thay đổi không?

---

## 23. Từ điển thuật ngữ

| Thuật ngữ | Nghĩa trong dự án |
| --- | --- |
| L1 cache | Cache RAM cục bộ trong một Node process |
| L2 cache | Redis cache dùng chung nhiều Node |
| Cache-aside | App đọc cache, miss thì đọc DB và điền cache |
| Cache stampede | Nhiều request cùng miss rồi cùng đánh DB |
| Single-flight | Nhiều caller dùng chung một tác vụ fetch đang chạy |
| LRU | Loại entry ít được dùng gần đây nhất khi đầy |
| TTL | Thời gian key/entry tồn tại |
| Token bucket | Rate-limit có capacity và tốc độ refill |
| Pipeline | Gửi nhiều Redis command trong một network batch |
| Lua atomic | Redis chạy cả script như một operation không bị xen lệnh khác |
| Idempotency | Gọi lại cùng ý định không tạo thêm side effect |
| Eventual consistency | Dữ liệu dẫn xuất đồng bộ sau, có khoảng stale ngắn |
| Outbox | Event được commit cùng dữ liệu domain rồi phát đi sau |
| p50/p95/p99 | Latency mà 50/95/99% request không vượt quá |
| Fail-open | Dependency lỗi thì cho request đi tiếp |
| Fail-closed | Dependency lỗi thì từ chối request |
| Source of truth | Nơi dữ liệu chuẩn có thẩm quyền |

---

## 24. Kết luận của Tech Lead

Dự án đã vượt qua mức CRUD cơ bản: nó có nhiều Node instance, Redis atomicity, cache hai tầng, search async, privacy-aware caching, cursor pagination và product test thực tế. Giá trị lớn nhất không nằm ở số công nghệ, mà ở các invariant đã được mã hóa và kiểm thử:

- Không trả dữ liệu cache sai user.
- Token một lần chỉ được dùng một lần dưới concurrency.
- JWT hợp lệ không bị token rác đẩy khỏi cache dễ dàng.
- Rate limit và revocation dùng trạng thái tập trung giữa nhiều Node.
- Update study session không mất dữ liệu khi concurrent.
- Retry sync không tạo StudySession trùng.
- Write API không bị Elasticsearch giữ chân.
- Danh sách không tăng response vô hạn theo dữ liệu.

Bước trưởng thành tiếp theo không phải thêm nhiều framework hơn. Hãy chốt các contract nghiệp vụ còn mơ hồ, đóng answer replay/data-integrity gap, biến search queue thành outbox đáng tin cậy, xử lý WebSocket demo và bổ sung observability. Khi đó hệ thống mới chuyển từ “đồ án kỹ thuật tốt” sang “sản phẩm có thể vận hành có trách nhiệm”.
