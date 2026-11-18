# 배포 설정

앱은 Supabase Auth(Google 로그인)와 Supabase PostgreSQL을 사용하고, GitHub Actions가 `main` push마다 Elastic Beanstalk에 배포해요. 이 문서의 URL과 변수 이름은 `infrastructure/supabase/redirect-urls.ts`, `infrastructure/runtime-environment.ts`와 같아야 해요. `tests/deployment/deployment-config.test.ts`가 둘이 일치하는지 검사해요.

## 1. 연결 문자열 두 개

| 변수 | 쓰는 곳 | 값 |
|---|---|---|
| `DATABASE_URL` | 앱 런타임 (Beanstalk) | Supabase **Transaction pooler** (포트 6543). 끝에 `?pgbouncer=true`를 붙여요. |
| `DIRECT_URL` | migration (GitHub Actions) | 포트 5432 연결. Supabase의 직접 연결 호스트가 IPv6 전용이면 GitHub Actions에서 접속할 수 없으니 **Session pooler** (포트 5432) 주소를 써요. |

앱 런타임은 `DIRECT_URL`을 읽지 않고, migration 단계는 `DATABASE_URL`을 쓰지 않아요. 두 값 모두 서버 전용이라 `NEXT_PUBLIC_` 접두사를 붙이지 않아요.

## 2. Elastic Beanstalk 환경 속성

Beanstalk 콘솔 → 환경 → 구성 → 업데이트, 모니터링 및 로깅 → 환경 속성에 등록해요.

| 변수 | 필수 | 설명 |
|---|---|---|
| `DATABASE_URL` | 예 | 위 1절의 Transaction pooler 주소 |
| `APP_BASE_URL` | 예 | `https://d277aj369o96rd.cloudfront.net` (경로 없이 origin만, production은 HTTPS) |
| `NEXT_PUBLIC_SUPABASE_URL` | 예 | `https://<project-ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | 예 | `sb_publishable_…` 키. 예전 프로젝트는 대신 `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| `SCHEDULER_ENABLED` | 아니오 | 기본 `true`. `false`면 발송 스케줄러를 끄는 긴급 스위치 |
| `SCHEDULER_POLL_MS` | 아니오 | 기본 `30000` (5000~300000) |
| `SCHEDULER_BATCH_SIZE` | 아니오 | 기본 `50` (1~500) |
| `SCHEDULER_LOOKBACK_DAYS` | 아니오 | 기본 `35` (1~365) |
| `LOG_LEVEL` | 아니오 | 기본 `info` |

`sb_secret_…` 키나 `service_role` 키는 어디에도 넣지 않아요. 공개 키 자리에 넣으면 서버가 시작을 거부해요.

검사는 두 번 해요.

- **배포 전 (GitHub Actions):** 위 필수 변수의 이름이 Beanstalk 환경 속성에 있는지 확인해요. 값은 조회하지 않아요.
- **서버 시작 시 (`instrumentation.ts`):** 형식까지 검사하고, 문제가 있으면 변수 이름만 로그에 남긴 뒤 시작을 멈춰요.

## 3. GitHub Actions Secrets

| Secret | 필수 | 설명 |
|---|---|---|
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | 예 | 배포용 IAM 사용자 |
| `DIRECT_URL` | 권장 | 등록하면 배포 전에 `prisma migrate deploy`를 실행해요. 없으면 경고만 남기고 건너뛰어요. |

## 4. OAuth Redirect URL

로그인 흐름은 브라우저 → Google → **Supabase Auth** → 앱의 `/auth/callback` 순서예요.

**Supabase 대시보드** → Authentication → URL Configuration

- Site URL: `https://d277aj369o96rd.cloudfront.net`
- Redirect URLs:
  - `http://localhost:3000/auth/callback`
  - `https://d277aj369o96rd.cloudfront.net/auth/callback`

**Supabase 대시보드** → Authentication → Sign In / Providers → Google: Google OAuth Client ID와 Secret을 여기에 넣어요. 앱 환경 변수에는 넣지 않아요.

**Google Cloud Console** → API 및 서비스 → 사용자 인증 정보 → OAuth 클라이언트

- 승인된 리디렉션 URI: `https://<project-ref>.supabase.co/auth/v1/callback`
- 승인된 JavaScript 원본: `http://localhost:3000`, `https://d277aj369o96rd.cloudfront.net`

## 5. 노출 금지 확인

- `/api/health/live`, `/api/health/ready`는 상태 문자열과 요청 ID만 반환해요. DB 오류 원문은 응답에 넣지 않아요.
- 로거는 `DATABASE_URL`, `DIRECT_URL` 값과 연결 문자열 형태, 이메일, 토큰을 `[REDACTED]`로 바꿔요.
- 배포 번들에서는 `.env*`, 키 파일, 로그를 빼요.
