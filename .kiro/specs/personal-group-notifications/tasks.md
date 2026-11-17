# Implementation Plan: 개인·그룹 알림 서비스

## Overview

빈 저장소에서 Next.js App Router와 TypeScript 프로젝트를 초기화한 뒤 PostgreSQL 스키마, Auth.js 인증, 도메인 규칙, 다중 프로세스에 안전한 발송 스케줄러, 모바일 우선 화면을 순서대로 구현한다. 기능·권한은 `requirements.md`를 따르고, 화면 구조와 문구는 `ui-design-with-screens/ui-design.md` 및 `screens/*.html`을 따른다. 별도 알림 상세 화면은 만들지 않으며, 받은 알림 카드에서 읽기와 확인을 처리한다.

## Tasks

- [x] 1. 프로젝트와 자동 검증 기반 구축
  - [x] 1.1 Next.js App Router TypeScript 프로젝트를 저장소 루트에 초기화한다
    - Node.js 26 호환 버전, TypeScript strict, ESLint, npm lockfile과 `dev`, `build`, `start`, `lint`, `typecheck`, `test`, `test:e2e` 스크립트를 구성한다.
    - 환경 파일, 빌드 결과, 테스트 산출물과 비밀값이 Git에 포함되지 않도록 프로젝트 설정을 작성한다.
    - _Requirements: 1.1, 1.13_

  - [x] 1.2 테스트 러너와 격리된 테스트 환경을 구성한다
    - Vitest, React Testing Library, user-event, axe, fast-check, Playwright를 단일 실행 모드로 구성한다.
    - PostgreSQL 통합 테스트 DB에 migration을 적용하고 테스트마다 데이터를 격리하는 helper를 작성한다.
    - _Requirements: 1.1, 2.8, 9.9, 10.13, 11.1_

  - [x] 1.3 공통 설정, 로깅, 오류 결과와 health route를 구현한다
    - 환경 변수 Zod schema, Prisma singleton, request ID, 비밀값을 제거하는 JSON logger와 공통 `ActionResult` 오류 mapper를 구현한다.
    - `/api/health/live`와 DB 및 migration 호환성을 검사하는 `/api/health/ready`를 구현하고 민감한 오류 원문이 응답되지 않게 테스트한다.
    - _Requirements: 1.6, 1.13, 2.2, 3.8, 16.6_

- [x] 2. PostgreSQL 스키마와 데이터 접근 계층 구현
  - [x] 2.1 인증, 사용자, 친구, 그룹과 초대 스키마를 작성한다
    - Prisma에 Auth.js 모델, `User`, `Friend`, `Group`, 가입 이력을 보존하는 `Membership`, hash token만 저장하는 `Invite`를 정의한다.
    - 정규화 이메일 고유성, 자기 친구 금지, 활성 멤버십 partial unique index, 가입 시점 조회 index와 FK 정책을 SQL migration에 추가한다.
    - _Requirements: 1.2, 2.4, 2.8, 3.1, 3.2, 3.3, 4.5, 4.6, 5.3_

  - [x] 2.2 알림, 일정, 회차와 응답 스키마를 작성한다
    - `Notification`, `PersonalTarget`, `NotificationDraft`, `ScheduleClaim`, `Dispatch`, `DispatchRecipient` 모델과 enum을 정의한다.
    - 대상 종류 XOR, 일정 종류별 필수 필드, 비어 있지 않은 문장, claim·회차·수신자 중복 방지 제약과 조회 index를 SQL migration에 추가한다.
    - _Requirements: 7.3, 7.5, 8.2, 9.9, 10.1, 10.2, 11.1, 11.2, 11.3_

  - [x] 2.3 repository와 트랜잭션·잠금 primitive를 구현한다
    - 사용자, 친구, 그룹, 멤버십, 알림, draft, claim, 회차 repository를 application 계층이 사용할 typed interface로 구현한다.
    - 그룹별 transaction advisory lock, 조건부 갱신, DB `now()`와 transaction timestamp 접근을 parameter binding된 SQL로 캡슐화한다.
    - _Requirements: 5.3, 9.6, 9.9, 11.1, 13.3, 13.4_

  - [x] 2.4 스키마 제약과 migration 통합 테스트를 작성한다
    - 빈 DB와 직전 schema에 migration을 적용하고 이메일·친구·활성 멤버십·대상 XOR·claim·회차·수신자 고유 제약을 실제 PostgreSQL에서 검증한다.
    - 잘못된 transaction이 일부 행만 남기지 않고 rollback되는지 검증한다.
    - _Requirements: 2.8, 4.7, 7.3, 9.9, 11.1, 11.5_

- [x] 3. 공통 도메인 검증과 인증 구현
  - [x] 3.1 닉네임, 이메일, 그룹 이름과 알림 문장 validator를 구현한다
    - Unicode code point 기준 닉네임 길이, 기본 이메일 형식과 소문자 정규화, 공백 그룹 이름과 공백 알림 문장 거부를 순수 함수와 Zod schema로 구현한다.
    - _Requirements: 1.3, 1.4, 1.9, 1.10, 1.11, 2.1, 2.2, 2.3, 3.4, 7.5_

  - [x] 3.2 Property 1 닉네임 정규화와 상태 보존 속성 테스트를 작성한다
    - Unicode·공백 문자열 generator로 유효 후보 저장과 무효 후보의 기존 닉네임 보존을 검증한다.
    - **Property 1: 닉네임 정규화와 상태 보존**
    - **Validates: Requirements 1.3, 1.4, 1.9, 1.10, 1.11**

  - [x] 3.3 로그인 복귀 경로 sanitizer를 구현한다
    - 동일 origin의 `/` 시작 내부 경로와 query만 허용하고 외부 URL, scheme-relative URL, 제어 문자와 잘못된 encoding을 `/inbox`로 대체한다.
    - _Requirements: 1.7, 1.8, 4.2_

  - [x] 3.4 Property 2 로그인 복귀 경로의 동일 출처 보장 속성 테스트를 작성한다
    - 임의 URL 문자열에 대해 결과가 허용된 내부 경로 또는 `/inbox`이고 외부 origin으로 이동하지 않음을 검증한다.
    - **Property 2: 로그인 복귀 경로의 동일 출처 보장**
    - **Validates: Requirements 1.7**

  - [x] 3.5 Property 3 이메일 형식과 정규화의 일관성 속성 테스트를 작성한다
    - 이메일 구조와 대소문자·주변 공백 변형 generator로 validator와 정규화 함수의 일관성을 검증한다.
    - **Property 3: 이메일 형식과 정규화의 일관성**
    - **Validates: Requirements 2.1, 2.2, 2.3**

  - [x] 3.6 Property 5 공백 그룹 이름 거부 속성 테스트를 작성한다
    - 다양한 Unicode 공백으로만 구성된 입력이 그룹과 멤버십을 생성하지 않음을 검증한다.
    - **Property 5: 공백 그룹 이름 거부**
    - **Validates: Requirements 3.4**

  - [x] 3.7 Auth.js Google 인증과 database session을 구현한다
    - Google provider만 등록하고 검증된 정규화 이메일로 신규 사용자를 만들며 기존 사용자는 재사용한다.
    - 신규 Google 이름을 닉네임 규칙으로 검사하고, OAuth 실패·취소 시 계정을 만들지 않으며 보안 cookie와 로그아웃 session 폐기를 구현한다.
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.12, 1.13_

  - [x] 3.8 보호 route, 로그인 화면과 프로필 설정 화면을 구현한다
    - 모든 보호 layout, query, Server Action에서 `requireUser()`를 적용하고 안전한 `returnTo`로 로그인 전 경로를 복원한다.
    - `Main.html` 기준 `/login`과 `/profile/setup`을 구현하고 유효한 닉네임 저장 전 보호 기능 진입을 제한한다.
    - _Requirements: 1.7, 1.8, 1.9, 1.10, 1.11, 1.13, 4.2_

  - [x] 3.9 인증·프로필 통합 및 컴포넌트 테스트를 작성한다
    - 신규·기존 사용자 callback, 실패·취소, 보호 route, 초대 복귀, 닉네임 경계, 로그아웃과 비인증 데이터 차단을 자동 검증한다.
    - _Requirements: 1.1~1.13, 4.2_

- [x] 4. 디자인 시스템과 공통 화면 셸 구현
  - [x] 4.1 디자인 토큰과 반응형 애플리케이션 셸을 구현한다
    - UI 명세의 색상, 서체, 크기, radius, 간격을 CSS 변수로 만들고 390px 기준 단일 열, 최대 640px, `100dvh`, safe area와 고정 하단 영역을 구현한다.
    - 320px, 390×844, 768px 이상에서도 사용자 콘텐츠가 가려지거나 가로로 넘치지 않게 구성한다.
    - _Requirements: 2.9, 6.1, 12.4, 14.3, 17.2_

  - [x] 4.2 접근 가능한 공통 UI 컴포넌트를 구현한다
    - 헤더, 카드, 버튼, 입력, textarea, segmented control, chip, checkbox, radio, switch, dialog, badge, avatar, progress, skeleton, 안내·빈·오류·권한 없음 상태를 구현한다.
    - visible label, `aria-describedby`, live region, focus trap, 44px 터치 영역, focus ring과 reduced motion을 적용한다.
    - _Requirements: 1.11, 2.10, 3.7, 5.1, 12.5, 14.4, 14.5, 16.5, 16.6, 17.5_

  - [x] 4.3 보호 화면 내비게이션과 route 상태 경계를 구현한다
    - `/inbox`, `/sent`, `/friends`, `/groups` 하단 탭과 작성·상세 화면의 헤더 및 닫기·뒤로가기를 화면 이동표대로 연결한다.
    - route별 `loading.tsx`, `error.tsx`, `not-found.tsx`를 공통 상태 컴포넌트에 연결한다.
    - _Requirements: 2.10, 3.9, 12.10, 16.6, 17.5_

  - [x] 4.4 공통 UI 컴포넌트 자동화 테스트를 작성한다
    - 키보드 조작, 접근 가능한 이름·상태, dialog 초점 복원, selector 화살표 이동, 200% 확대와 axe 위반 여부를 검증한다.
    - _Requirements: 5.1, 6.2, 12.5, 14.1, 16.2_

- [x] 5. 친구, 그룹, 초대와 멤버십 구현
  - [x] 5.1 친구 추가 command와 친구 목록 query를 구현한다
    - 이메일 형식·정규화, 가입 사용자 조회, 자기 자신·미가입·중복 거부와 단방향 저장을 transaction 및 unique 충돌 처리로 구현한다.
    - 목록에는 현재 사용자의 친구 닉네임과 이메일만 projection한다.
    - _Requirements: 2.1~2.9_

  - [x] 5.2 Property 4 친구 관계의 방향성과 고유성 속성 테스트를 작성한다
    - 친구 추가 명령열 model로 자기 자신과 중복이 없고 무효 명령이 기존 집합을 보존하는지 검증한다.
    - **Property 4: 친구 관계의 방향성과 고유성**
    - **Validates: Requirements 2.2, 2.6, 2.7, 2.8**

  - [x] 5.3 `/friends` 화면과 자동화 테스트를 구현한다
    - `Friends.html` 기준 추가 카드, 목록, 안내 상자, 새 알림 버튼과 친구가 없는 빈 상태 및 필드 오류·성공 feedback을 구현한다.
    - 목록 query가 빈 경우와 친구 추가 오류에서도 입력값과 초점이 유지되는지 컴포넌트 테스트한다.
    - _Requirements: 2.1, 2.2, 2.5, 2.6, 2.7, 2.9, 2.10_

  - [x] 5.4 그룹 생성, 초대 수락, 탈퇴와 공개 설정 command를 구현한다
    - 그룹과 생성자 멤버십을 한 transaction으로 만들고 최초 가입·재가입은 새 이력과 `PRIVATE` 설정을 생성한다.
    - 활성 멤버의 재수락은 기존 가입 시각과 설정을 보존하고, 탈퇴는 확인된 요청에서 현재 멤버십을 조건부 종료하며 그룹 lock을 사용한다.
    - _Requirements: 3.1, 3.2, 3.3, 4.3, 4.4, 4.5, 4.6, 4.7, 5.1~5.4_

  - [x] 5.5 Property 6 멤버십 이력 상태기계 속성 테스트를 작성한다
    - 가입·공개 변경·탈퇴·재가입 command model로 활성 이력 수, 최신 가입 시각과 재가입 기본 공개값을 검증한다.
    - **Property 6: 멤버십 이력 상태기계**
    - **Validates: Requirements 4.3, 4.5, 4.6, 4.7, 5.4**

  - [x] 5.6 hash 기반 초대 링크 발급과 조회를 구현한다
    - 현재 구성원만 256-bit 이상 raw token을 발급하게 하고 DB에는 SHA-256 hash만 저장하며 raw token을 로그에서 제거한다.
    - 유효·잘못된 초대 조회, 이미 가입 상태와 로그인 후 원 초대 복귀에 필요한 projection을 구현한다.
    - _Requirements: 3.5, 3.6, 3.7, 3.8, 4.1, 4.2, 4.7, 4.8_

  - [x] 5.7 Property 7 초대 발급 권한 속성 테스트를 작성한다
    - 임의 사용자·그룹·멤버십 상태에서 현재 활성 멤버십이 있을 때만 발급 정책이 참인지 검증한다.
    - **Property 7: 초대 발급 권한**
    - **Validates: Requirements 3.8**

  - [x] 5.8 그룹 목록·상세 query와 이메일 최소 공개 projection을 구현한다
    - 현재 소속 그룹만 구성원 수와 최근 발송일과 함께 반환하고, 그룹 상세는 요청자의 현재 멤버십을 검사한다.
    - 모든 닉네임을 표시하되 각 그룹 멤버십이 `PUBLIC`인 사용자 이메일만 select·반환하며 다른 그룹의 설정은 갱신하지 않는다.
    - _Requirements: 3.9, 6.1~6.6_

  - [x] 5.9 Property 8 그룹별 이메일 공개의 최소 노출과 비간섭 속성 테스트를 작성한다
    - 그룹별 멤버 projection과 설정 변경 model로 비공개 이메일 미노출, 다른 그룹 설정 보존, 외부 사용자 projection 거부를 검증한다.
    - **Property 8: 그룹별 이메일 공개의 최소 노출과 비간섭**
    - **Validates: Requirements 6.2, 6.3, 6.4, 6.5, 6.6**

  - [x] 5.10 그룹 목록·상세·초대·탈퇴 화면을 구현한다
    - `Groups.html`, `GroupDetail.html`, `Invite.html` 기준 화면과 그룹 없음, 잘못된 초대, 이미 구성원, 복사 성공·실패, 권한 없음 상태를 구현한다.
    - 그룹 상세에 그룹별 이메일 switch, 구성원 목록, 탈퇴 확인 dialog와 이 그룹에 알림 보내기 동작을 연결한다.
    - _Requirements: 3.5~3.9, 4.1, 4.3~4.8, 5.1~5.4, 6.1~6.6_

  - [x] 5.11 친구·그룹·초대·탈퇴 PostgreSQL 통합 테스트를 작성한다
    - 생성 transaction, 동시 초대 수락, 탈퇴·재가입, 그룹별 공개 설정 row 범위와 외부 사용자의 직접 URL 거부를 실제 DB에서 검증한다.
    - _Requirements: 2.4~2.8, 3.1~3.8, 4.4~4.8, 5.2~5.4, 6.4~6.6_

- [x] 6. 알림 작성과 대상 검증 구현
  - [x] 6.1 작성 옵션 query와 만료 가능한 DB draft를 구현한다
    - 개인 모드에는 현재 친구만, 그룹 모드에는 현재 멤버십 그룹만 반환한다.
    - 한 문장, 대상 mode와 검증된 최소 target ID를 소유자·30분 만료와 함께 저장하고 예약 성공 시 한 번만 소비되게 한다.
    - _Requirements: 7.1, 7.2, 8.1, 9.1, 9.2_

  - [x] 6.2 Property 9 알림 대상의 배타성과 문장 유효성 속성 테스트를 작성한다
    - 임의 문장과 개인·그룹 대상 조합에서 trim 후 문장이 있고 대상 종류가 정확히 하나일 때만 저장 가능한지 검증한다.
    - **Property 9: 알림 대상의 배타성과 문장 유효성**
    - **Validates: Requirements 7.3, 7.4, 7.5**

  - [x] 6.3 개인 대상 validator와 고정 대상 저장을 구현한다
    - 한 명 이상의 중복 없는 요청 대상이 발신자의 친구 집합 부분집합인지 서버에서 재검증하고 `PersonalTarget`으로 저장한다.
    - 비어 있거나 친구가 아닌 대상이 있으면 알림·draft 소비·회차 생성을 모두 막는다.
    - _Requirements: 8.1~8.4_

  - [x] 6.4 Property 10 개인 대상 선택과 스냅샷 속성 테스트를 작성한다
    - 친구 집합과 요청 집합 generator로 유효 부분집합의 수신자 동일성 및 무효 입력의 비생성을 검증한다.
    - **Property 10: 개인 대상 선택과 스냅샷**
    - **Validates: Requirements 8.1, 8.2, 8.3, 8.4**

  - [x] 6.5 그룹 대상 validator와 등록 권한을 구현한다
    - 그룹을 정확히 하나만 허용하고 알림 등록 시 발신자의 현재 활성 멤버십을 query 조건과 command 양쪽에서 검사한다.
    - _Requirements: 9.1~9.5_

  - [x] 6.6 Property 11 그룹 대상 선택과 등록 권한 속성 테스트를 작성한다
    - 임의 멤버십과 그룹 입력에서 선택 가능 그룹 집합, 단일 그룹 제약과 등록 허용 조건을 검증한다.
    - **Property 11: 그룹 대상 선택과 등록 권한**
    - **Validates: Requirements 9.1, 9.2, 9.3, 9.4, 9.5**

  - [x] 6.7 개인·그룹 알림 작성 화면과 컴포넌트 테스트를 구현한다
    - `ComposePersonal.html`과 `ComposeGroup.html` 기준 한 문장 입력, mode radio group, 친구 checkbox, 그룹 radio와 수신 예정 미리보기를 구현한다.
    - 그룹 상세에서 진입한 그룹 초기 선택, 빈 옵션, 검증 실패 시 입력 보존과 다음 단계 이동을 자동 검증한다.
    - _Requirements: 7.1~7.5, 8.1, 8.3, 8.4, 9.1~9.6_

- [x] 7. Asia/Seoul 일정 계산과 예약 구현
  - [x] 7.1 Luxon 기반 순수 일정 계산기를 구현한다
    - 일회성, DAILY, WEEKLY, MONTHLY 예정일과 월말 보정, 주말 다음 평일 이동, effective date별 합치기와 UTC instant 변환을 구현한다.
    - 시스템 timezone에 의존하지 않는 `calculateDueSlots` 및 다음 발송 미리보기 interface를 제공한다.
    - _Requirements: 10.1~10.13_

  - [x] 7.2 Property 13 반복 예정일 생성 속성 테스트를 작성한다
    - 윤년·월말·연말을 포함한 날짜 generator로 DAILY 간격, WEEKLY 요일·간격과 MONTHLY 월말 보정을 검증한다.
    - **Property 13: 반복 예정일 생성**
    - **Validates: Requirements 10.3, 10.4, 10.5, 10.6**

  - [x] 7.3 Property 14 주말 이동의 첫 평일 규칙 속성 테스트를 작성한다
    - 임의 예정일과 옵션에 대해 발송일이 예정일 또는 이후의 가장 이른 월요일~금요일인지 검증한다.
    - **Property 14: 주말 이동의 첫 평일 규칙**
    - **Validates: Requirements 10.8, 10.9, 10.10, 10.12**

  - [x] 7.4 Property 15 같은 발송일의 회차 합치기 속성 테스트를 작성한다
    - 예정일 목록 generator로 effective date별 슬롯이 하나이고 모든 source date가 손실·중복 없이 보존되는지 검증한다.
    - **Property 15: 같은 발송일의 회차 합치기**
    - **Validates: Requirements 10.11**

  - [x] 7.5 Property 16 Asia/Seoul 시각 왕복 속성 테스트를 작성한다
    - 유효한 KST 날짜·시각을 UTC instant로 변환한 뒤 복원한 값과 다른 process timezone에서의 결과가 같은지 검증한다.
    - **Property 16: Asia/Seoul 시각 왕복**
    - **Validates: Requirements 10.13**

  - [x] 7.6 발송 일정 화면과 자동화 테스트를 구현한다
    - `Schedule.html` 기준 일회성 날짜·시각, 반복 시작일·주기별 필드, 주말 제외 switch와 다음 발송 미리보기를 구현한다.
    - DAILY·WEEKLY·MONTHLY의 조건부 입력, 과거 시각, 잘못된 일자·요일과 만료·타인 draft 오류를 검증한다.
    - _Requirements: 10.1~10.13_

  - [x] 7.7 알림 예약 command와 draft 단일 소비를 구현한다
    - 예약 시 일정, draft 소유자와 개인·그룹 권한을 다시 검사하고 `Notification`과 `PersonalTarget`을 한 transaction에서 생성한다.
    - 중복 제출이 같은 draft로 알림을 두 번 만들지 않게 하고 성공 후 보낸 알림 또는 응답 현황 route로 연결한다.
    - _Requirements: 7.3~7.5, 8.2~8.4, 9.2~9.5, 10.1~10.13_

  - [x] 7.8 예약 transaction과 일정 예시 통합 테스트를 작성한다
    - 일회성·세 반복 유형, 월말, 토·일 이동, draft 만료·중복 소비와 권한 재검증을 실제 DB에 대해 검증한다.
    - _Requirements: 7.3~7.5, 8.2~8.4, 9.3, 9.5, 10.1~10.13_

- [ ] 8. 다중 프로세스 안전 발송 스케줄러 구현
  - [x] 8.1 만기 슬롯 claim과 회차 생성 transaction을 구현한다
    - DB 현재 시각으로 제한된 batch의 후보를 찾고 알림·effective date advisory lock 및 unique claim을 사용한다.
    - claim, `Dispatch`, sequence와 `DispatchRecipient` 전체를 한 transaction에서 확정하고 실패 시 모두 rollback한다.
    - _Requirements: 10.1, 10.11, 11.1, 11.2, 11.3_

  - [x] 8.2 개인·그룹 회차 수신자 snapshot 정책을 구현한다
    - 개인 알림은 저장된 `PersonalTarget`, 그룹 알림은 발송 transaction 시점의 현재 구성원에서 발신자를 제외한 집합을 사용한다.
    - 그룹 발신자 탈퇴와 수신자 0명은 이유가 있는 `SKIPPED` claim으로 기록하고 회차는 만들지 않는다.
    - _Requirements: 8.2, 9.6~9.9, 11.1~11.5_

  - [ ] 8.3 Property 12 그룹 회차 수신자 집합 속성 테스트를 작성한다
    - 현재 구성원 집합과 발신자 generator로 수신자가 정확히 구성원 집합에서 발신자를 뺀 중복 없는 집합인지 검증한다.
    - **Property 12: 그룹 회차 수신자 집합**
    - **Validates: Requirements 9.6, 9.9**

  - [ ] 8.4 Property 18 회차 초기화와 스냅샷 독립성 속성 테스트를 작성한다
    - 여러 회차·멤버 변경·확인 명령열에서 새 수신자는 미확인이고 다른 회차와 과거 수신자 snapshot이 변하지 않는지 검증한다.
    - **Property 18: 회차 초기화와 스냅샷 독립성**
    - **Validates: Requirements 11.1, 11.2, 11.3, 11.4, 11.5**

  - [x] 8.5 production poller와 catch-up 진입점을 구현한다
    - `instrumentation.ts`에서 production Node 런타임에만 폴러를 시작하고 전역 중복 시작 방지, 겹치는 tick 안전성, 종료 신호를 처리한다.
    - 35일 lookback, batch 상한, 슬롯별 오류 경계, 최대 3회 재시도와 `runSchedulerTick(clock)` 테스트 진입점을 구현한다.
    - _Requirements: 9.7, 9.8, 10.1, 10.14_

  - [ ] 8.6 claim·회차 동시성 PostgreSQL 통합 테스트를 작성한다
    - 여러 connection과 poller가 같은 슬롯을 처리해도 claim·회차가 하나인지, 중간 실패 후 재시도가 완전한 snapshot 하나를 만드는지 검증한다.
    - 발송과 탈퇴의 두 commit 순서, 토·일·월 합류, 발신자 탈퇴와 수신자 없음 skip을 검증한다.
    - _Requirements: 9.6~9.9, 10.11, 11.1~11.5_

  - [ ] 8.7 반복 알림 중지 command를 구현한다
    - 발신자만 활성 반복 알림을 조건부 중지하고 `stoppedAt` 이후 due instant를 후보에서 제외하며 중복 요청은 멱등 처리한다.
    - 기존 회차와 응답은 수정하거나 삭제하지 않는다.
    - _Requirements: 10.14, 10.15_

  - [ ] 8.8 Property 17 반복 중지 경계와 과거 보존 속성 테스트를 작성한다
    - 임의 중지 시각과 기존 회차 model로 중지 이후 슬롯 제외 및 기존 회차·응답의 비변경을 검증한다.
    - **Property 17: 반복 중지 경계와 과거 보존**
    - **Validates: Requirements 10.14, 10.15**

- [ ] 9. 받은 알림과 명시적 확인 구현
  - [ ] 9.1 받은 알림 query를 구현한다
    - `DispatchRecipient` 기준 최신 회차별 카드, 본인 응답, 발신자·mode·회차·발송 시각과 미확인 수를 같은 snapshot에서 projection한다.
    - 개인 회차는 수신자 여부, 그룹 회차는 현재 멤버십까지 검사하고 외부 사용자의 그룹 카드를 제외한다.
    - _Requirements: 12.1~12.5, 12.10, 12.11, 13.1_

  - [ ] 9.2 Property 19 외부 사용자의 받은 그룹 카드 제외 속성 테스트를 작성한다
    - 임의 사용자·그룹 회차·현재 멤버십에서 외부 사용자의 받은 목록에 그룹 카드가 없음을 검증한다.
    - **Property 19: 외부 사용자의 받은 그룹 카드 제외**
    - **Validates: Requirements 12.11**

  - [ ] 9.3 멱등적인 확인 command를 구현한다
    - 세션 사용자가 회차 수신자이고 그룹이면 현재 구성원인지 서버에서 확인한 뒤 `confirmedAt IS NULL` 조건으로 transaction timestamp를 저장한다.
    - 재요청에는 최초 시각을 반환하고 비수신자·탈퇴자의 요청은 모든 응답 행을 그대로 둔 채 거부한다.
    - _Requirements: 13.1~13.6_

  - [ ] 9.4 Property 20 확인의 명시성 및 멱등성 속성 테스트를 작성한다
    - 임의 횟수의 목록 읽기와 확인 명령열에서 읽기는 상태를 바꾸지 않고 최초 확인 시각만 유지되는지 검증한다.
    - **Property 20: 확인의 명시성 및 멱등성**
    - **Validates: Requirements 13.1, 13.2, 13.3, 13.4**

  - [ ] 9.5 Property 21 무권한 확인의 원자적 비변경 속성 테스트를 작성한다
    - 비수신자 또는 탈퇴자의 확인 요청이 거부되고 회차의 모든 응답 상태와 시각이 전후 동일한지 검증한다.
    - **Property 21: 무권한 확인의 원자적 비변경**
    - **Validates: Requirements 13.5, 13.6**

  - [ ] 9.6 `/inbox` 회차별 카드 화면을 구현한다
    - `Inbox.html` 기준 그룹 미확인·확인, 개인 미확인·확인 카드를 만들고 요구된 버튼 조합, 확인 시각, 빈 상태, 안내 상자와 새 알림 동작을 구현한다.
    - 별도 상세 route 없이 카드에서 문장을 읽고 확인하며 개인 수신자에게 응답 현황 버튼을 표시하지 않는다.
    - _Requirements: 12.1~12.11, 13.1~13.4_

  - [ ] 9.7 받은 목록·확인 컴포넌트 및 DB 통합 테스트를 작성한다
    - 목록·카드 렌더가 mutation을 호출하지 않는지, 최초 확인·재확인·비수신자·탈퇴·확인과 탈퇴 경쟁 결과를 자동 검증한다.
    - _Requirements: 12.2~12.11, 13.1~13.6_

- [ ] 10. 응답 현황과 보낸 알림 구현
  - [ ] 10.1 역할별 응답 현황 query를 구현한다
    - 회차 selector, 선택 회차 수신자와 snapshot 기반 확인·전체 집계를 한 query snapshot에서 반환한다.
    - 개인 발신자는 전체, 개인 수신자는 본인 행만 projection하고 제3자는 문장도 받지 않게 한다.
    - 그룹은 현재 멤버십과 최신 가입 시점을 검사하고 가입 전 회차에는 metadata-only 비활성 selector만 반환한다.
    - _Requirements: 14.1~14.7, 15.1~15.3, 16.1~16.9_

  - [ ] 10.2 Property 22 응답 집계 정확성 속성 테스트를 작성한다
    - 임의 회차 응답 벡터와 선택 변경에서 전체 수와 확인 수가 선택 회차 snapshot만으로 계산되는지 검증한다.
    - **Property 22: 응답 집계 정확성**
    - **Validates: Requirements 14.2, 14.6, 14.7**

  - [ ] 10.3 Property 23 개인 응답 현황의 역할별 최소 projection 속성 테스트를 작성한다
    - 발신자·수신자·제3자 역할별로 반환 가능한 행과 필드가 설계된 최소 범위와 정확히 같은지 검증한다.
    - **Property 23: 개인 응답 현황의 역할별 최소 projection**
    - **Validates: Requirements 15.1, 15.2, 15.3**

  - [ ] 10.4 Property 24 그룹 회차 조회 권한의 필요충분 조건 속성 테스트를 작성한다
    - 가입·탈퇴·재가입 이력과 발송 시각 generator로 현재 구성원이며 최신 가입 시각 이후일 때만 응답 정보가 반환되는지 검증한다.
    - **Property 24: 그룹 회차 조회 권한의 필요충분 조건**
    - **Validates: Requirements 16.1, 16.2, 16.4, 16.5, 16.6, 16.7, 16.8, 16.9**

  - [ ] 10.5 보낸 알림 query를 구현한다
    - 발신자의 알림마다 문장, mode, 일정 요약과 최근 조회 가능 회차 집계를 가진 카드 하나를 반환한다.
    - 그룹 알림은 발신자가 현재 해당 그룹 구성원일 때만 포함하고 반복 중지 상태를 projection한다.
    - _Requirements: 17.1~17.5, 10.14, 10.15_

  - [ ] 10.6 Property 25 보낸 그룹 알림 목록의 현재 멤버십 필터 속성 테스트를 작성한다
    - 임의 발신 알림·멤버십 집합에서 개인은 포함되고 그룹은 현재 구성원인 경우에만 포함되는지 검증한다.
    - **Property 25: 보낸 그룹 알림 목록의 현재 멤버십 필터**
    - **Validates: Requirements 17.4**

  - [ ] 10.7 응답 현황과 확정된 보낸 알림 목록 화면을 구현한다
    - `Status.html` 기준 selector, 조회 불가 회차, 집계·진행 막대·수신자 상태와 확인 시각을 구현하고 외부 사용자는 전용 권한 없음 상태만 보이게 한다.
    - `/sent`에 알림별 카드, 개인·그룹 badge, 일정, 최근 `확인 M/N`, 응답 현황 버튼, 반복 중지와 빈 상태를 공통 디자인 토큰으로 구현한다.
    - _Requirements: 14.1~14.7, 15.1~15.3, 16.1~16.9, 17.1~17.5_

  - [ ] 10.8 응답 현황·보낸 목록 query 및 컴포넌트 통합 테스트를 작성한다
    - 개인 역할별 열·행 제한, 그룹 가입 경계와 탈퇴 후 직접 URL, selector 전환, 집계 정확성, 보낸 카드 수와 빈 상태를 자동 검증한다.
    - _Requirements: 14.1~14.7, 15.1~15.3, 16.1~16.9, 17.1~17.5_

- [ ] 11. 화면 상태, 반응형과 접근성 자동 검증 완성
  - [ ] 11.1 모든 주요 화면의 빈·로딩·오류·권한 없음 상태를 연결한다
    - 친구·그룹·받은·보낸 목록, 그룹 상세, 초대, 작성, 일정과 응답 현황에 입력 보존, skeleton, 재시도, 404와 최소 정보 권한 오류를 구현한다.
    - 긴 한글 문장·닉네임·그룹명·이메일은 의미를 잃지 않으면서 wrapping 또는 접근 가능한 전체값을 제공한다.
    - _Requirements: 1.6, 2.2, 2.5, 2.6, 2.7, 2.10, 3.4, 3.7, 3.8, 3.9, 4.8, 12.10, 16.5, 16.6, 17.5_

  - [ ] 11.2 화면별 접근성·반응형 컴포넌트 테스트를 작성한다
    - 폼 label·오류 연결, live feedback, switch·radio·checkbox·dialog·selector 키보드 동작과 색 외 상태 표현을 검증한다.
    - 320px, 390×844, 768px, 1280px 및 200% 확대에서 가로 넘침과 고정 하단 가림을 자동 검사한다.
    - _Requirements: 5.1, 6.2, 12.4~12.9, 14.1, 14.4, 14.5, 16.2_

  - [ ] 11.3 확정 시안 기반 visual regression 테스트를 작성한다
    - `screens/*.html`에 대응하는 로그인, 친구, 그룹, 그룹 상세, 초대, 개인·그룹 작성, 일정, 받은 알림과 응답 현황의 390×844 기준 이미지를 검증한다.
    - 신규 `/sent` 및 빈·오류·권한 없음 상태도 같은 토큰을 사용하는 기준 이미지를 추가한다.
    - _Requirements: 2.9, 3.5, 4.1, 6.1, 7.1, 7.2, 12.4~12.10, 14.1~14.5, 17.1~17.5_

- [ ] 12. 보안, 관측성과 배포 준비 코드 구현
  - [ ] 12.1 Server Action과 route의 공통 보안 경계를 구현한다
    - 모든 변경 경로에 session actor, Zod 입력 제한, 동일 origin 검사, ORM parameter binding과 자원별 IDOR 정책을 적용한다.
    - Google origin만 허용하는 CSP, 보안 cookie, 로그인·친구 추가 rate limit과 raw token·이메일·알림 문장 로그 제거를 구성한다.
    - _Requirements: 1.13, 2.3~2.7, 3.8, 6.6, 8.3, 9.5, 13.5, 13.6, 15.3, 16.6_

  - [ ] 12.2 스케줄러와 상태 변경 관측 코드를 구현한다
    - 인증, 친구, 그룹, 알림, scheduler, 확인과 인가 거부 이벤트를 request ID 및 민감하지 않은 내부 ID로 구조화한다.
    - tick 후보·sent·skipped·conflict·error 수, 처리 시간, oldest due age와 scheduler heartbeat를 health/smoke 검사 가능한 projection으로 만든다.
    - _Requirements: 9.7, 9.8, 10.1, 10.14, 11.1, 13.3_

  - [ ] 12.3 보안 회귀 및 오류 비노출 통합 테스트를 작성한다
    - `returnTo` open redirect, CSRF성 cross-origin 요청, 친구·그룹·draft·알림·회차 IDOR, session 위조, rate limit과 중복 제출을 검증한다.
    - 로그·Action·route 응답에 OAuth token, session token, raw invite token, 전체 이메일, 알림 문장과 DB 오류 원문이 없는지 검증한다.
    - _Requirements: 1.6, 1.7, 1.13, 3.8, 6.6, 7.4, 8.3, 9.5, 13.5, 15.3, 16.6_

  - [ ] 12.4 migration·CI·Elastic Beanstalk 배포 준비 구성을 작성한다
    - GitHub Actions에 PostgreSQL service, `prisma migrate deploy`, lint, `next typegen`, typecheck, 단위·속성·통합·E2E 테스트와 production build 단계를 구성한다.
    - migration 실패 시 배포 job이 실행되지 않게 하고 Node.js 26 `next start`, `PORT`, `/api/health/ready` smoke 검사와 secret 없는 환경 변수 검증 단계를 코드로 정의한다.
    - _Requirements: 1.13, 10.1, 11.1, 16.6_

- [ ] 13. 수용 시나리오 E2E와 최종 자동 품질 게이트 구현
  - [ ] 13.1 production과 분리된 인증 fixture와 데모 seed를 구현한다
    - 민수·지수·유나·현우, 단방향 친구 관계, 운영팀, 가입·탈퇴 이력과 개인·그룹 반복 알림을 테스트 DB에 결정적으로 생성한다.
    - 테스트 인증 helper와 seed는 production build와 runtime에서 import하거나 실행할 수 없게 조건부 entrypoint로 분리한다.
    - _Requirements: 1.1, 2.4, 3.1, 4.4, 5.3, 8.2, 9.6, 11.1_

  - [ ] 13.2 인증·친구·개인 알림 E2E 테스트를 작성한다
    - 미인증 보호 route와 로그인 복귀, 친구 추가, 개인 알림 작성·일회성 예약·회차 생성·카드 확인·발신자 전체 현황을 자동화한다.
    - 목록 열람만으로 미확인이 유지되고 개인 수신자에게 본인 상태 외 응답 정보가 노출되지 않음을 검증한다.
    - _Requirements: 1.1~1.13, 2.1~2.10, 7.1~7.5, 8.1~8.4, 12.1~12.10, 13.1~13.5, 15.1~15.3_

  - [ ] 13.3 그룹·초대·이메일 공개·탈퇴 E2E 테스트를 작성한다
    - 그룹 생성, 초대 링크 로그인 복귀·수락, 그룹별 이메일 공개, 그룹 알림과 응답 현황을 자동화한다.
    - 1회차 후 가입자의 과거 selector 조회 불가, 이후 회차 조회, 탈퇴 후 받은·보낸 목록과 직접 URL의 권한 제거를 검증한다.
    - _Requirements: 3.1~3.9, 4.1~4.8, 5.1~5.4, 6.1~6.6, 9.1~9.9, 16.1~16.9_

  - [ ] 13.4 반복 일정·동시성·회차 독립성 E2E 및 통합 시나리오를 작성한다
    - 매주 토요일과 주말 제외, 같은 월요일 합류, 다음 회차의 미확인 초기화, 한 회차 확인의 다른 회차 비간섭을 `runSchedulerTick(clock)`으로 검증한다.
    - 다중 tick, 발송·탈퇴 경쟁, 확인·탈퇴 경쟁과 반복 중지 후 과거 기록 보존을 PostgreSQL 통합 시나리오로 검증한다.
    - _Requirements: 9.6~9.9, 10.1~10.15, 11.1~11.5, 13.1~13.6_

  - [ ] 13.5 요구사항 추적 자동 검사와 최종 품질 게이트를 구현한다
    - 수용 기준 추적표 1~9의 테스트 ID가 CI 결과에 모두 존재하는지 검사하는 script를 작성한다.
    - lint, typecheck, 단위·속성·통합·E2E·axe·visual regression과 production build를 단일 비대화식 명령으로 실행하고 실패 시 종료하도록 구성한다.
    - _Requirements: 1.1~1.13, 2.1~2.10, 3.1~3.9, 4.1~4.8, 5.1~5.4, 6.1~6.6, 7.1~7.5, 8.1~8.4, 9.1~9.9, 10.1~10.15, 11.1~11.5, 12.1~12.11, 13.1~13.6, 14.1~14.7, 15.1~15.3, 16.1~16.9, 17.1~17.5_

- [ ] 14. Supabase Auth·PostgreSQL 인증 경계 전환
  - [x] 14.1 Supabase SSR 인증 클라이언트와 환경 설정 경계를 구현한다
    - `@supabase/ssr` 기반 browser client, Server Component/Action/Route Handler용 server client, cookie 갱신 middleware를 분리하고 브라우저에는 URL과 publishable key만 노출한다.
    - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, 런타임 pooled `DATABASE_URL`, migration 전용 direct `DIRECT_URL`을 별도 Zod schema로 검증한다. `DATABASE_URL`과 `DIRECT_URL`은 서버 전용으로 유지하고 값·연결 문자열을 로그나 클라이언트 번들에 넣지 않는다.
    - _Requirements: 1.1, 1.6, 1.7, 1.12, 1.13_

  - [x] 14.2 Auth.js 사용자·세션 스키마를 Supabase `auth.users` 기반 앱 프로필과 도메인 FK로 전환한다
    - Prisma의 Auth.js `Account`, `Session`, `VerificationToken` 모델과 adapter 의존을 제거하고, 앱 프로필의 식별자를 `auth.users.id`에 연결한다. 친구·멤버십·알림·회차 등 모든 사용자 FK와 repository projection을 새 프로필 식별자로 전환한다.
    - SQL migration으로 `auth.users` 신규 사용자에 대한 앱 프로필 생성과 Google metadata 기반 초기 닉네임 후보를 처리한다. 이미 배포된 Auth.js 데이터가 있으면 정규화 이메일로 대응되는 `auth.users`를 검증·매핑하고, 매핑 불가 행은 삭제하지 않고 migration을 실패 또는 격리 보고하게 한다.
    - 데이터 정합성을 확인한 뒤에만 legacy Auth.js 세션·provider 테이블과 코드 참조를 제거하며 OAuth access/refresh token을 앱 도메인 테이블로 복사하지 않는다.
    - _Requirements: 1.1~1.6, 1.9~1.13, 2.3, 2.8, 3.1, 4.4, 5.3, 8.2, 9.6, 11.1_

  - [x] 14.3 RLS와 Prisma 서버 권한 모델을 명시적으로 구성한다
    - 앱 도메인 테이블은 browser/PostgREST 직접 접근을 허용하지 않는 기본 거부 RLS 및 최소 grant로 구성하고, 브라우저 Supabase client는 인증 세션 처리 외 도메인 데이터를 직접 조회·변경하지 않게 한다.
    - 서버 전용 pooled Prisma 연결이 RLS를 우회하는 private database role로 동작하는 경우, 사용자별 권한 판단의 유일한 정책 집행점은 `requireUser()`와 query/command의 자원별 조건임을 코드와 migration 주석으로 고정한다. RLS 정책만으로 IDOR 방어를 위임하지 않는다.
    - migration·runtime·anon/authenticated 역할별 접근 테스트를 추가하여 runtime role만 필요한 테이블 권한을 가지며 anon/authenticated 역할은 사용자 데이터에 접근할 수 없음을 검증한다.
    - _Requirements: 1.13, 2.9, 3.8, 6.6, 8.3, 9.5, 13.5, 13.6, 15.3, 16.6_

  - [x] 14.4 Supabase Google OAuth callback, 로그아웃과 안전한 복귀 경로를 구현한다
    - 로그인 시작은 Google provider의 Supabase OAuth 요청으로 바꾸고, callback route에서 authorization code를 서버 cookie session으로 교환한 성공 후에만 앱 프로필을 준비한다. 실패·취소에는 앱 프로필과 도메인 데이터를 만들지 않고 일반 오류를 표시한다.
    - Google 및 Supabase에 등록할 callback/redirect origin을 배포 origin으로 제한한다. `returnTo`는 OAuth 요청 전 server cookie 또는 서명된 단기 상태로 보관하고 기존 sanitizer로 내부 `/` 경로와 query만 복원하며 외부 URL, scheme-relative URL, 제어 문자는 `/inbox`로 대체한다.
    - server-side logout으로 Supabase 세션을 종료하고 cookie를 제거하며, browser/session 갱신 경계가 보호 route와 Server Action에서 같은 인증 결과를 사용하게 한다.
    - _Requirements: 1.1, 1.5~1.8, 1.12, 1.13, 4.1, 4.2_

  - [x] 14.5 인증·인가 의존 코드를 Supabase 세션 주체로 재연결한다
    - `requireUser()`, protected layout, middleware, Server Action, query service와 health-safe auth error mapper에서 Auth.js session/API를 제거하고 검증된 Supabase 세션 사용자 ID와 앱 프로필을 사용하게 한다.
    - 닉네임 설정 전 보호 기능 제한, 그룹 현재 멤버십, 개인/그룹 알림·응답 현황·확인 권한이 Supabase 인증 식별자에서 시작하되 기존 도메인 권한 predicate를 계속 서버에서 재검증하게 한다.
    - _Requirements: 1.7~1.13, 3.8, 4.2, 5.1~5.4, 6.6, 8.3, 9.5, 13.5, 13.6, 15.3, 16.1~16.9_

  - [ ] 14.6 Supabase 세션 모델의 인증·권한 회귀 테스트를 작성한다
    - Supabase SSR cookie session을 이용해 신규·기존 Google 사용자 프로필, OAuth callback 실패/취소, logout, 보호 경로 복귀, 닉네임 설정 전 차단을 자동 검증한다. 실제 Google 창은 열지 않고 Supabase auth client/callback 경계를 격리한다.
    - Supabase 세션 사용자와 다른 사용자 ID를 주입한 친구·그룹·draft·알림·회차 요청, 탈퇴 후 그룹 조회, 개인 수신자의 최소 projection을 통합/E2E로 검증한다. browser client에 DB URL, direct URL 또는 service role key가 포함되지 않는지도 검사한다.
    - _Requirements: 1.1~1.13, 2.3~2.9, 3.8, 4.2, 6.6, 8.3, 9.5, 13.5, 13.6, 15.1~15.3, 16.1~16.9_

  - [ ] 14.7 Supabase 환경별 migration·CI·Elastic Beanstalk 배포 설정을 갱신한다
    - migration job은 `DIRECT_URL`만 사용하고 애플리케이션 runtime은 pooled `DATABASE_URL`만 사용하도록 Prisma 설정과 GitHub Actions 환경 변수 계약을 분리한다. 공개 URL/publishable key와 서버 비밀값의 누락·형식 오류를 배포 전 검증한다.
    - Supabase dashboard와 Google Cloud Console에 등록할 개발·배포 callback URL 및 allowed redirect URL 목록을 배포 설정 문서/검증 상수로 관리하고, production build와 `/api/health/ready`가 OAuth secret·DB URL을 응답이나 로그로 노출하지 않음을 확인한다.
    - _Requirements: 1.1, 1.6, 1.7, 1.12, 1.13, 10.1, 11.1, 16.6_

## Notes

- 모든 테스트 하위 작업은 필수이며 선택 작업으로 표시하지 않았다.
- 각 속성 기반 테스트는 `design.md`의 Correctness Property 번호와 요구사항 절을 직접 참조한다.
- Google OAuth 자체는 E2E에서 자동화하지 않고 production에 포함되지 않는 인증 fixture로 대체하며, callback 계약은 통합 테스트로 검증한다.
- 배포 관련 작업은 migration, CI/CD, health check와 smoke 검사 구성을 코드로 작성하는 범위이며 실제 환경 배포 실행은 포함하지 않는다.
- **전환 가정:** Supabase Auth가 Google OAuth와 세션 cookie를 소유한다. `auth.users`는 인증 주체이고 앱 프로필 및 친구·그룹·알림 도메인 데이터는 별도 앱 스키마에 둔다. browser Supabase client는 인증에만 사용하며 앱 도메인 데이터는 Next.js 서버와 Prisma를 통해서만 접근한다.
- **RLS 가정:** 앱 도메인 테이블에는 browser/PostgREST 직접 접근을 막는 기본 거부 RLS와 최소 권한 grant를 적용한다. 서버 전용 Prisma runtime role의 RLS 우회는 허용하되, 사용자별 인가의 최종 책임은 계속 server-side `requireUser()` 및 repository/query predicate에 둔다.
- **설계 정합화 필요:** 현 `design.md`의 Auth.js Google Provider, PostgreSQL Adapter, database session, Auth.js 모델 설명은 이 전환과 충돌한다. Task 14를 실행하기 전에 또는 함께 design.md를 Supabase SSR·`auth.users`·RLS 결정에 맞게 후속 갱신해야 한다. 이 요청의 범위에 따라 design.md와 requirements.md는 변경하지 않았다.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["6.4", "6.6", "7.2", "7.3", "7.4", "7.5", "7.6", "14.1"] },
    { "id": 1, "tasks": ["14.2"] },
    { "id": 2, "tasks": ["14.3"] },
    { "id": 3, "tasks": ["14.4"] },
    { "id": 4, "tasks": ["14.5", "14.7"] },
    { "id": 5, "tasks": ["7.7", "14.6"] },
    { "id": 6, "tasks": ["7.8", "8.1"] },
    { "id": 7, "tasks": ["8.2"] },
    { "id": 8, "tasks": ["8.3", "8.4", "8.5", "8.7"] },
    { "id": 9, "tasks": ["8.6", "8.8", "9.1", "9.3", "10.1", "10.5"] },
    { "id": 10, "tasks": ["9.2", "9.4", "9.5", "9.6", "10.2", "10.3", "10.4", "10.6"] },
    { "id": 11, "tasks": ["9.7", "10.7", "12.1", "12.2"] },
    { "id": 12, "tasks": ["10.8", "11.1", "12.3"] },
    { "id": 13, "tasks": ["11.2", "11.3", "12.4", "13.1"] },
    { "id": 14, "tasks": ["13.2", "13.3", "13.4"] },
    { "id": 15, "tasks": ["13.5"] }
  ]
}
```
