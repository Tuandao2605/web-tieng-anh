# Web Tiếng Anh

Ứng dụng học tiếng Anh/flashcard gồm:

- `Frontend`: React + Vite + Zustand + TanStack Query
- `Backend`: NestJS + Fastify + TypeScript + Prisma + MongoDB + Redis
- `docker-compose.yml`: MongoDB replica set, Mongo Express và Redis

## Chạy local

### 1. Khởi động database và Redis

```bash
docker compose up -d
docker compose ps
```

Mongo Express: `http://localhost:8081`

### 2. Chạy Backend

```bash
cd Backend
cp .env.example .env
npm ci
npm run dev
```

Backend chạy tại `http://localhost:3000`.

NestJS/Fastify là HTTP bootstrap duy nhất và chạy tại `http://localhost:3000`, thay thế cổng Express cũ. API, các trang EJS, session/flash/CSRF và static files được phục vụ từ Nest; Socket.IO được khởi chạy cùng Nest trên `WEBSOCKET_PORT` (mặc định `8000`). URL và response contract hiện có được giữ nguyên. PM2 production chạy Nest API và background worker riêng.

Scheduler và BullMQ workers chạy trong process riêng, không khởi chạy từ Nest API. Khi phát triển local, chạy thêm terminal thứ hai:

```bash
npm run dev:workers
```

PM2 production cũng chạy đúng một instance `web-hoctienganh-workers`. `npm run start:workers` là entrypoint production tương ứng.

`InfrastructureModule` đăng ký Prisma, Redis và `cacheService` làm global providers, dùng lại đúng các singleton hiện có. Khi Nest shutdown, Socket.IO, queue, Prisma, Redis và cache Pub/Sub được đóng theo lifecycle.

### 3. Chạy Frontend

Mở terminal khác:

```bash
cd Frontend
npm ci
npm run dev
```

Frontend chạy tại `http://localhost:5500` và proxy `/api` sang Backend.

## Các luồng API chính

- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `GET /api/v1/auth/me`
- `GET /api/v1/sets`
- `POST /api/v1/sets`
- `GET /api/v1/sets/:id`
- `PUT /api/v1/sets/:id`
- `POST /api/v1/sets/:id/quiz`
- `POST /api/v1/study/submit-answer`
- `POST /api/v1/study/sync-progress`

## Lưu ý

Không commit file `Backend/.env`. Hãy đổi `JWT_SECRET` và `JWT_REFRESH_SECRET` khi dùng ngoài môi trường local.
