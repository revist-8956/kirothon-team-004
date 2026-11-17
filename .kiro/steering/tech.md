---
inclusion: always
---

# 기술 스택 및 개발 원칙 (Technology Stack)

## 1. 핵심 기술 스택

- **프레임워크:** Next.js 16.x (App Router, 최신 안정 패치)
- **언어:** TypeScript 6.x (Strict Mode, 최신 안정 패치)
- **UI 라이브러리:** React 및 React DOM 19.x (Next.js와 호환되는 버전)
- **스타일링:** Tailwind CSS 4.x
- **패키지 매니저:** npm
- **런타임:** Node.js 24.x (LTS, 최신 안정 패치)
- **UI 컴포넌트:** shadcn/ui (필요 시 도입)
- **API:** Next.js Route Handlers
- **데이터 검증:** Zod 4.x (필요 시 도입)

버전 기준일: 2026-11-13. Node.js 24는 호환성을 고려한 LTS 기준이며, 팀원과 배포 환경의 Node.js 버전을 통일한다. Next.js 16의 최소 Node.js 요구 버전은 20.9이지만, 이 프로젝트는 위 LTS 버전을 사용한다.

TypeScript 7은 정식 출시되었지만 7.0에는 도구에서 사용하는 프로그래밍 API가 없어, 편집기 플러그인과 린터 호환성을 고려해 우선 6.x를 사용한다. 프로젝트 초기화 시 실제 의존성의 호환성을 확인하고 설치된 정확한 버전은 잠금 파일로 공유한다.

참고: [Next.js 지원 정책](https://nextjs.org/support-policy), [Next.js 설치 요구 사항](https://nextjs.org/docs/app/getting-started/installation), [Node.js 릴리스](https://nodejs.org/en/about/previous-releases), [TypeScript 7.0 릴리스 안내](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/), [Zod 4 릴리스 안내](https://zod.dev/v4).

초기화 담당자는 위 버전 범위에서 정식 릴리스를 선택하고, 검증에 사용한 Node.js 버전과 앱 실행 경로를 README에 기록한다. 의존성을 변경한 사람은 `package.json`과 `package-lock.json`을 함께 커밋한다. 다른 팀원은 앱 디렉터리에서 `npm ci`로 같은 버전을 설치한다.

## 2. 아키텍처

- Next.js App Router를 사용한다.
- 프론트엔드와 백엔드를 통합한 단일 Next.js 애플리케이션을 기본으로 한다.
- React Server Components를 기본으로 사용한다.
- 클릭 핸들러, 상태 훅(`useState` 등), 브라우저 API를 쓰는 컴포넌트 파일 상단에 `'use client'`를 선언한다. 페이지에서 버튼만 상호작용한다면 버튼 컴포넌트에 선언한다.
- HTTP API는 Route Handlers(`app/api/**/route.ts`)를 활용한다.
- 앱 내부 폼에서만 호출하는 저장·삭제 작업에는 Server Actions를 사용할 수 있다. 외부 클라이언트나 웹훅에 HTTP 엔드포인트를 제공할 때는 Route Handler를 사용한다.
- 비즈니스 로직은 UI 컴포넌트 및 API 핸들러와 분리한다.
- 별도 서버가 필요한 기능(예: Python 전용 모델 실행)이 생기면 담당자가 배포 방식과 호출 인터페이스를 `design.md`에 적고 팀과 합의한다.

## 3. TypeScript 개발 규칙

- TypeScript의 Strict Mode를 활성화한다.
- `any` 타입 사용을 지양하고 명시적인 타입을 정의한다.
- 요청 본문, 외부 API 응답, 모델 출력은 `unknown`으로 받아 필수 필드와 타입을 검증한 뒤 사용한다. 여러 곳에서 같은 JSON 구조를 검증한다면 Zod 스키마를 공유하고 타입을 추론한다.
- API 요청과 응답에 대한 타입을 정의한다.
- 모듈 경로는 `@/` 별칭을 활용한다.
- 불필요하게 복잡한 추상화보다 명확하고 읽기 쉬운 구현을 우선한다.

## 4. 프론트엔드 개발

- 스타일링에는 Tailwind CSS를 사용한다.
- 반복되는 UI 요소는 재사용 가능한 컴포넌트로 분리한다.
- 대화상자처럼 포커스 이동과 키보드 조작을 함께 구현해야 하는 UI는 shadcn/ui 컴포넌트를 활용할 수 있다.
- 핵심 시연 화면은 휴대폰 너비와 발표용 화면 너비에서 입력·제출·결과 확인이 가능한지 확인한다.
- 비동기 제출 화면에는 처리 중 상태를 표시하고 중복 제출을 막는다. 조회 결과가 비어 있으면 빈 상태를, 요청이 실패하면 오류와 다음 행동을 보여준다.
- 불필요한 전역 상태 관리 라이브러리를 도입하지 않는다.
- Server Components와 Client Components의 역할을 명확하게 구분한다.

## 5. 백엔드 및 API

- HTTP API는 Next.js Route Handlers를 기본으로 사용한다.
- 외부에서 전달되는 입력값은 서버에서 검증한다.
- 런타임 데이터 검증이 필요한 경우 Zod를 활용한다.
- JSON API는 아래 응답 타입을 사용한다. 조회 성공은 200, 리소스 생성은 201, 잘못된 입력은 400, 리소스 없음은 404, 예상하지 못한 서버 오류는 500을 기본값으로 한다.
- Route Handler에는 요청 및 응답 처리에 필요한 최소한의 로직만 작성한다.
- 비즈니스 로직은 별도의 모듈로 분리한다.
- 외부 API 호출에는 배포 환경의 요청 제한 시간보다 짧은 타임아웃을 설정한다. 시간 초과나 호출 한도 초과 시 화면에서 대기를 끝내고 재시도 가능 여부를 안내한다.
- 서버 전용 로직과 인증 정보를 Client Components에 노출하지 않는다.

## 6. AI 모델 연동

- AI 모델 호출은 서버에서 수행한다.
- API Key 및 인증 정보를 클라이언트에 노출하지 않는다.
- 특정 AI 제공자의 SDK에 비즈니스 로직이 직접 종속되지 않도록 구성한다.
- AI가 생성한 구조화 데이터는 검증한 후 사용한다.
- 모델 호출 실패, 타임아웃, 요청 제한에 대응한다.
- 생성 중인 텍스트를 사용자가 먼저 읽어야 하는 화면은 스트리밍을 사용할 수 있다. 스키마 검증이 필요한 결과는 검증을 마친 뒤 화면에 반영한다.
- 불필요한 다중 에이전트 구성이나 모델 호출을 지양한다.

AI 제공자 및 모델은 프로젝트 요구사항이 확정된 후 결정한다.

## 7. 데이터베이스

- 사용자가 나중에 결과를 다시 열거나 여러 사용자가 같은 레코드를 조회·수정해야 할 때 데이터베이스 도입을 검토한다.
- 데이터베이스와 ORM은 실제 요구사항에 따라 결정한다.
- 데이터베이스 접근 로직은 UI 컴포넌트 및 HTTP 요청 처리 로직과 분리한다.
- 관계형 데이터베이스를 도입하는 경우 마이그레이션으로 스키마 변경을 관리한다.
- 불필요한 데이터 저장 및 복잡한 데이터 모델링을 지양한다.

## 8. 보안

- API Key와 비밀 정보는 환경 변수로 관리한다.
- `.env.local` 및 인증 정보를 Git에 커밋하지 않는다.
- `NEXT_PUBLIC_` 접두사는 클라이언트에 공개해도 되는 환경 변수에만 사용한다.
- 외부 입력값은 신뢰하지 않고 검증한다.
- 사용자별 데이터에 접근하는 Route Handler와 Server Action은 서버에서 세션을 확인하고 해당 사용자의 조회·수정 권한을 검사한다.
- 로그에 인증 정보나 민감한 사용자 데이터를 기록하지 않는다.

## 9. 테스트 및 품질 관리

- ESLint를 이용해 정적 코드 검사를 수행한다.
- Next.js 16에서는 `next build`가 린트를 자동 실행하지 않으므로 ESLint CLI를 `lint` 스크립트로 별도 실행한다.
- TypeScript 타입 검사를 수행한다.
- 프로덕션 빌드가 정상적으로 완료되는지 확인한다.
- 핵심 비즈니스 로직과 API 동작에 대한 테스트를 작성한다.
- 주요 사용자 시나리오가 정상 동작하는지 검증한다.

앱 초기화 후 코드 변경을 병합하기 전에 앱 디렉터리에서 다음 항목을 확인한다.

1. `npm run lint` — 정적 코드 검사
2. `npx tsc --noEmit` — TypeScript 타입 검사
3. 변경한 기능의 관련 테스트를 실행한다. 자동 테스트가 없으면 PR에 재현 입력과 기대 결과를 적고 직접 확인한다.
4. `npm run build` — 통합 작업 및 주요 변경 완료 시
5. 검증 실패 시 원인을 분석하고 수정한다.

프로젝트에 정의되지 않은 명령어를 임의로 실행하지 않으며, 검증할 수 없는 항목은 명확하게 보고한다.

## 10. 개발 원칙

- 정상적으로 동작하는 MVP 완성을 최우선으로 한다.
- 프레임워크에서 기본 제공하는 기능을 우선 활용한다.
- 불필요한 라이브러리 및 외부 의존성을 추가하지 않는다.
- 요구사항이 없는 기능을 임의로 구현하지 않는다.
- 과도한 추상화와 불필요한 설계 패턴을 지양한다.
- 성능 최적화보다 기능의 정확성과 안정성을 우선한다.
- 기존 프로젝트의 코드 스타일과 구조를 유지한다.
- 프레임워크 교체, 별도 서버 추가, DB 도입처럼 다른 팀원의 실행·배포 방법이 달라지는 결정은 구현 전에 팀과 합의하고 이유를 `design.md`에 기록한다.

## 11. 프로젝트 구조

아래 경로는 Next.js 앱의 `package.json`이 있는 디렉터리를 기준으로 한다.

```
src/
├── app/                        # Next.js App Router
│   ├── (routes)/               # 페이지 라우트 그룹
│   │   └── results/page.tsx    # /results
│   ├── api/                    # Route Handlers
│   │   └── [endpoint]/
│   │       └── route.ts
│   ├── layout.tsx              # 루트 레이아웃
│   ├── page.tsx                # 루트 페이지
│   ├── loading.tsx             # 로딩 UI
│   └── error.tsx               # 에러 UI
│
├── components/                 # 공통 재사용 컴포넌트
│   ├── ui/                     # shadcn/ui 및 atomic 컴포넌트
│   │   ├── button.tsx
│   │   └── input.tsx
│   └── [ComponentName].tsx     # 도메인 공통 컴포넌트
│
├── features/                   # 기능별 모듈
│   └── [feature-name]/
│       ├── components/         # 해당 기능 전용 컴포넌트
│       ├── hooks/              # 해당 기능 전용 훅
│       ├── actions.ts          # Server Actions (필요 시)
│       └── types.ts            # 해당 기능 타입 정의
│
├── lib/                        # 유틸리티 및 헬퍼
│   ├── utils.ts                # 범용 유틸리티 함수
│   ├── validations.ts          # Zod 스키마 (필요 시)
│   └── [service].ts            # 외부 서비스 클라이언트
│
├── hooks/                      # 전역 커스텀 훅
│   └── use[HookName].ts
│
└── types/                      # 전역 타입 정의
    └── index.ts
```

### 파일 및 폴더 네이밍

- **컴포넌트 파일:** 직접 작성한 컴포넌트는 PascalCase(`UserCard.tsx`)를 쓰고, Next.js 특수 파일과 shadcn/ui 생성 파일은 원래 이름을 유지한다.
- **그 외 파일:** camelCase (`useAuth.ts`, `utils.ts`)
- **라우트 폴더:** kebab-case (`user-profile/`)
- **기능 모듈 폴더:** kebab-case (`features/user-profile/`)

### 컴포넌트 작성 규칙

- 직접 작성한 재사용 컴포넌트는 함수형 컴포넌트와 named export를 사용한다. Next.js의 `page.tsx`, `layout.tsx`처럼 default export가 필요한 파일은 프레임워크 규칙을 따른다.
- props는 인터페이스로 정의한다.
- 1파일 1컴포넌트를 원칙으로 한다.

```tsx
// ✅ 올바른 예시
interface UserCardProps {
  name: string;
  email: string;
}

export function UserCard({ name, email }: UserCardProps) {
  return (
    <div className="rounded-lg p-4">
      <p>{name}</p>
      <p>{email}</p>
    </div>
  );
}
```

### API 응답 구조

JSON 본문이 있는 API는 다음 타입을 공유한다. 파일이나 스트림을 반환하는 엔드포인트는 응답 형식을 `design.md`에 명시한다.

```ts
type ApiResponse<T> =
  | { data: T; error: null }
  | { data: null; error: string };
```
