# Web Tiếng Anh

Ứng dụng học tiếng Anh/flashcard gồm:

- `Frontend`: React + Vite + Zustand + TanStack Query
- `Backend`: Express + TypeScript + Prisma + MongoDB + Redis
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
