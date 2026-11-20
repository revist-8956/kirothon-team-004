// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { metadata } from "@/app/layout";
import {
  PREVIOUS_SERVICE_NAME,
  SERVICE_NAME,
  SHARED_ROLE,
  TEAM_MEMBERS,
  findMemberRoleStatements,
  findNonCanonicalServiceNames,
  headingOutline,
  isCanonicalServiceName,
  isValidTeamTable,
  projectMarkdownFiles,
  readmeBrandLocations,
  readmeTeamRows,
} from "../support/brand";

const root = process.cwd();
const readme = readFileSync(join(root, "README.md"), "utf8");

const nameVariants = fc.constantFrom(
  SERVICE_NAME,
  "했냥",
  PREVIOUS_SERVICE_NAME,
  " 했냥? ",
  "했냥?!",
  "했냥 ?",
  "알림 서비스",
  "",
);

describe("service name in user-facing brand positions", () => {
  // Feature: service-rebrand-ui, Property 5: 사용자 화면 브랜드명 정규화
  // **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5**
  it("Property 5: only the exact name 했냥? is accepted in brand positions", () => {
    fc.assert(
      fc.property(nameVariants, (value) => {
        expect(isCanonicalServiceName(value)).toBe(value.trim() === SERVICE_NAME);
      }),
      { numRuns: 200 },
    );
  });

  it("finds the previous name and the bare 했냥 used as a name, but not verb forms", () => {
    expect(findNonCanonicalServiceNames("밤티에서 보내요")).toEqual(["밤티"]);
    expect(findNonCanonicalServiceNames("했냥은 알림을 보내요")).toEqual(["했냥"]);
    expect(findNonCanonicalServiceNames("| 했냥 |")).toEqual(["했냥"]);
    expect(findNonCanonicalServiceNames("했냥?은 알림을 보내요")).toEqual([]);
    expect(findNonCanonicalServiceNames("밥 먹었냐고 물어봤냥고 했다")).toEqual([]);
  });

  it("uses 했냥? in the root metadata title and description", () => {
    expect(metadata.title).toBe("했냥?");
    expect(String(metadata.description)).toContain("했냥?");
    expect(findNonCanonicalServiceNames(String(metadata.title))).toEqual([]);
    expect(findNonCanonicalServiceNames(String(metadata.description))).toEqual([]);
  });
});

describe("README brand positions", () => {
  // Feature: service-rebrand-ui, Property 7: README 브랜드명 정규화
  // **Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5**
  it("Property 7: README brand positions accept only 했냥?", () => {
    // A sentence subject is a single word, so it never has surrounding spaces.
    const subjectVariants = fc.constantFrom(SERVICE_NAME, "했냥", PREVIOUS_SERVICE_NAME, "했냥?!", "서비스");
    fc.assert(
      fc.property(nameVariants, subjectVariants, nameVariants, (title, subject, header) => {
        const document = `# ${title}\n\n${subject}은 이 질문을 반복 알림으로 한 번만 등록해요.\n\n## 4. 기대 효과\n| 항목 | 기존 (메신저) | ${header} |\n|---|---|---|\n`;
        const found = readmeBrandLocations(document);
        const allCanonical = [found.title, found.problemSubject, found.comparisonHeader].every(isCanonicalServiceName);
        expect(allCanonical).toBe([title, subject, header].every((value) => value.trim() === SERVICE_NAME));
      }),
      { numRuns: 200 },
    );
  });

  it("uses 했냥? in the title, the problem-definition subject and the comparison header", () => {
    expect(readmeBrandLocations(readme)).toEqual({
      title: SERVICE_NAME,
      problemSubject: SERVICE_NAME,
      comparisonHeader: SERVICE_NAME,
    });
    expect(readme).not.toContain(PREVIOUS_SERVICE_NAME);
  });

  it("keeps the README structure and feature descriptions", () => {
    const outline = headingOutline(readme).filter((heading) => /^#{1,2} /u.test(heading));
    expect(outline).toEqual([
      "# 했냥?",
      "## 1. 문제 정의",
      "## 2. 핵심 기능",
      "## 3. 사용 시나리오",
      "## 4. 기대 효과",
      "## 5. 차별점",
      "## 6. 설치와 실행",
      "## 7. 테스트",
      "## 팀",
    ]);
    for (const feature of ["Google 로그인", "이메일로 친구 추가", "반복 알림 (매일·매주·매월, 주말 제외)", "회차별 응답 현황"]) {
      expect(readme).toContain(`| ${feature} |`);
    }
  });
});

describe("team roles", () => {
  // Feature: service-rebrand-ui, Property 8: README 팀 표의 공동 역할 정규화
  // **Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.8**
  it("Property 8: the team table is valid only with the three names in order and the exact shared role", () => {
    const roleVariants = fc.constantFrom(SHARED_ROLE, "기획", "개발", "AWS 환경 설정", "기획, 구현", "기획,구현,AWS 인프라 및 배포", "기획, 개발, AWS 인프라 및 배포");
    fc.assert(
      fc.property(
        fc.shuffledSubarray([...TEAM_MEMBERS], { minLength: 1, maxLength: 3 }),
        fc.array(roleVariants, { minLength: 3, maxLength: 3 }),
        (names, roles) => {
          const rows = names.map((name, index) => ({ name, role: roles[index]! }));
          const expected =
            names.length === 3 && names.every((name, index) => name === TEAM_MEMBERS[index]) && rows.every((row) => row.role === SHARED_ROLE);
          expect(isValidTeamTable(rows)).toBe(expected);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("lists 안준성, 문장혁, 김지수 with the shared role in the README", () => {
    const rows = readmeTeamRows(readme);
    expect(rows).toEqual(TEAM_MEMBERS.map((name) => ({ name, role: SHARED_ROLE })));
    for (const old of ["AWS 환경 설정", "개발"]) {
      expect(rows.some((row) => row.role === old)).toBe(false);
    }
  });

  // Feature: service-rebrand-ui, Property 9: 프로젝트 문서의 팀원별 역할 일관성
  // **Validates: Requirements 7.7**
  it("Property 9: per-member role statements are detected in tables, lists and sentences", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...TEAM_MEMBERS),
        fc.constantFrom("기획", "개발", SHARED_ROLE),
        fc.constantFrom("table", "list-colon", "parenthesis", "plain-sentence", "build-step"),
        (name, role, form) => {
          const document =
            form === "table"
              ? `| ${name} | ${role} |`
              : form === "list-colon"
                ? `- ${name}: ${role}`
                : form === "parenthesis"
                  ? `${name}(${role})가 참여했어요.`
                  : form === "plain-sentence"
                    ? `${name} 님이 발표했어요.`
                    : `| 기획 | Spec | 요구사항을 정리했어요 |`;
          const statements = findMemberRoleStatements(document);
          if (form === "plain-sentence" || form === "build-step") {
            expect(statements).toEqual([]);
          } else {
            expect(statements).toEqual([{ name, role }]);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it("has no per-member role other than the shared role in root and docs Markdown", () => {
    for (const file of projectMarkdownFiles(root)) {
      for (const statement of findMemberRoleStatements(readFileSync(file, "utf8"))) {
        expect(statement.role, `${file}: ${statement.name}`).toBe(SHARED_ROLE);
      }
    }
  });
});
