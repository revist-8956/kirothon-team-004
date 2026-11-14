# BUILD REPORT

## Kiro 활용 내역

| 단계 | 사용한 Kiro 기능 | 무엇을 했는지 | 결과물 위치 |
|---|---|---|---|
| 기획 | Spec (requirements, requirements-first 워크플로) | PRD 1~7절과 확정 UI 명세를 요구사항 17개와 EARS 형식 인수 조건으로 옮기고, PRD 7절 수용 기준 9개를 요구사항 번호와 연결한 추적표를 만들었어요. 미결 사항 14개도 함께 정리했어요. | `.kiro/specs/personal-group-notifications/requirements.md` |
| 기획 | Kiro 채팅 | PRD에서 대상 사용자, 문제 상황, 사용 시나리오, 기대 효과, 차별점을 정리해 README를 작성했어요. | `README.md` |
| 설계 | Spec (design) | 아키텍처, 데이터 모델, 권한 규칙, 발송 스케줄러, 오류 처리, 환경 변수, 테스트 전략을 설계했어요. Elastic Beanstalk에서 여러 프로세스가 동시에 떠도 발송 회차가 중복되지 않도록 DB 잠금 방식을 정했어요. | `.kiro/specs/personal-group-notifications/design.md` |
| 설계 | Kiro 채팅 + HTML 시안 | 화면 11개의 시안과 디자인 토큰, 공통 컴포넌트, 화면 이동, PRD와 달라진 점을 정리했어요. | `ui-design-with-screens/ui-design.md`, `ui-design-with-screens/screens/*.html` |
| 구현 | Spec (tasks) | 설계를 13개 단계, 81개 하위 태스크로 나누고 각 태스크에 관련 요구사항 번호를 붙였어요. 태스크 사이의 의존 관계는 wave 단위 그래프로 정리했어요. | `.kiro/specs/personal-group-notifications/tasks.md` |
| 구현 | Kiro 채팅 | 81개 태스크를 3명에게 나누고, 공통 선행 작업, 담당 디렉터리, 병합 순서, 스키마 변경 요청 절차를 정했어요. | `.kiro/specs/personal-group-notifications/work-split.md` |
| 검증 | Hooks | 태스크를 마칠 때 lint, 타입 검사, 테스트를 실행하도록 검증 hook을 두었어요. | `.kiro/hooks/verify-task.json` |
| 검증 | Steering + GitHub Actions | main에 push하면 lint, 타입 검사, 테스트, 빌드를 거친 뒤 Elastic Beanstalk에 배포해요. | `.github/workflows/deploy.yml` |
| 기타 | Steering | 기술 스택, 아키텍처, TypeScript 규칙, API 응답 형식, 보안, 검증 순서를 팀 공통 규칙으로 정해서 Kiro가 항상 참고하게 했어요. | `.kiro/steering/tech.md` |

## 개발 과정에서 바뀐 점

| 처음 계획 | 바뀐 내용 | 이유 |
|---|---|---|
| 알림을 열어 상세 화면에서 '확인' 버튼을 누름 (PRD 5절) | 상세 화면을 없애고, 받은 알림 카드에서 바로 '확인' | 화면을 줄여 확인까지의 단계를 줄이기 위해서예요. 상세 시안(`Detail.html`)은 구현하지 않기로 했어요. |
| 알림 구성이 정해지지 않음 | 제목과 본문 없이 한 문장으로 작성 | 할 일 확인용 알림이라 짧은 한 문장이면 충분했어요. |
| 이메일 공개를 사용자별로 설정 (PRD 2절) | 그룹마다 따로 설정 | 시안의 토글이 그룹 상세 화면에 있었어요. 가족 그룹에서는 공개하고 회사 그룹에서는 숨기는 식으로 쓸 수 있어요. |
| 보낸 알림이 응답 현황 화면 하나로 바로 연결 | 보낸 알림 목록 화면 추가 | 보낸 알림이 여러 개일 때 고를 화면이 시안에 없어서 요구사항 17로 추가했어요. |
| 별도 워커로 스케줄러 실행 | 웹 서버 프로세스 안에서 스케줄러를 시작하고 DB 잠금으로 중복 방지 | 배포 워크플로가 `next start` 하나만 실행해서, 서버를 추가하지 않고 동작하게 바꿨어요. |
| Node.js 24 기준 (`tech.md`) | 배포는 Node.js 26 | Elastic Beanstalk 환경이 Node.js 26 플랫폼이라 배포 기준을 맞췄어요. |
| 동아리 운영진 공지 서비스 | 친구, 연인, 가족, 동료가 서로 할 일을 확인하는 서비스 | 팀원의 실제 사례(데이트 약속 확인, 어머니 복약 확인)가 개인 사이의 일이었어요. |

## 어려웠던 점과 해결 방법

### Kiro 사용법
- **문제:** Spec, Steering, Hooks가 각각 언제 쓰이는지 처음에는 구분이 안 됐어요. 요구사항을 어디까지 써야 설계와 태스크로 넘어갈 수 있는지도 감이 없었어요.
- **해결:** requirements-first 워크플로를 따라 requirements → design → tasks 순서로 진행했어요. 한 단계를 끝내고 검토한 뒤 다음 단계로 넘어갔어요. 매번 반복해서 알려 줘야 하는 기술 스택과 코드 규칙은 Steering(`tech.md`)에 적어 Kiro가 항상 참고하게 했어요.

### PRD와 UI 시안이 서로 다를 때
- **문제:** PRD는 상세 화면에서 확인하라고 하고, 시안은 카드에서 바로 확인했어요. 이메일 공개 범위처럼 어느 쪽에도 없는 내용도 있었어요.
- **해결:** UI 명세 5장의 변경 사항을 우선한다는 규칙을 requirements 서두에 적었어요. 정해지지 않은 내용은 "가정 및 미결 사항"에 모아 팀이 하나씩 결정했어요.

### BUILD REPORT 작성
- **문제:** 개발 중에는 Kiro로 무엇을 했는지 따로 기록하지 않아서, 나중에 단계별로 정리하기 어려웠어요.
- **해결:** `.kiro/` 폴더의 결과물을 기준으로 단계를 되짚었어요. 각 행에 결과물 위치를 적어 심사자가 실제 파일로 확인할 수 있게 했어요.
