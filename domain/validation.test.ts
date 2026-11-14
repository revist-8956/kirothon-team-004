import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { groupNameSchema, isNonBlankText, notificationSentenceSchema } from "./content";
import { emailSchema, isBasicEmailFormat, normalizeEmail } from "./email";
import {
  countUnicodeCodePoints,
  isValidNickname,
  NICKNAME_ERROR_MESSAGE,
  nicknameSchema,
  normalizeNickname,
} from "./nickname";

const unicodeWhitespaceArbitrary = fc
  .array(fc.constantFrom(" ", "\t", "\n", "\r", "\u00a0", "\u1680", "\u2003", "\u202f", "\u205f", "\u3000", "\ufeff"))
  .map((characters) => characters.join(""));

const nicknameCodePointArbitrary = fc.constantFrom(
  "가",
  "김",
  "A",
  "é",
  "😀",
  "🫶",
  "中",
  "\u0301",
  "-",
);

const validNicknameCandidateArbitrary = fc
  .tuple(
    unicodeWhitespaceArbitrary,
    fc.array(nicknameCodePointArbitrary, { minLength: 1, maxLength: 20 }),
    unicodeWhitespaceArbitrary,
  )
  .map(([leadingWhitespace, characters, trailingWhitespace]) =>
    `${leadingWhitespace}${characters.join("")}${trailingWhitespace}`,
  );

const invalidNicknameCandidateArbitrary = fc.oneof(
  fc
    .array(fc.constantFrom(" ", "\t", "\n", "\r", "\u00a0", "\u1680", "\u2003", "\u202f", "\u205f", "\u3000", "\ufeff"), {
      minLength: 1,
      maxLength: 40,
    })
    .map((characters) => characters.join("")),
  fc
    .tuple(
      unicodeWhitespaceArbitrary,
      fc.array(nicknameCodePointArbitrary, { minLength: 21, maxLength: 40 }),
      unicodeWhitespaceArbitrary,
    )
    .map(([leadingWhitespace, characters, trailingWhitespace]) =>
      `${leadingWhitespace}${characters.join("")}${trailingWhitespace}`,
    ),
);

describe("nickname validation", () => {
  it("trims surrounding whitespace and preserves internal whitespace", () => {
    expect(normalizeNickname("  김 민수\n")).toBe("김 민수");
    expect(nicknameSchema.parse("  김 민수\n")).toBe("김 민수");
  });

  it("counts Unicode code points instead of UTF-16 code units", () => {
    const twentyAstralCharacters = "😀".repeat(20);

    expect(twentyAstralCharacters.length).toBe(40);
    expect(countUnicodeCodePoints(twentyAstralCharacters)).toBe(20);
    expect(isValidNickname(twentyAstralCharacters)).toBe(true);
    expect(nicknameSchema.parse(twentyAstralCharacters)).toBe(twentyAstralCharacters);
  });

  it("rejects empty, whitespace-only, and over-20-code-point nicknames", () => {
    expect(nicknameSchema.safeParse("").success).toBe(false);
    expect(nicknameSchema.safeParse("\u3000\u00a0").success).toBe(false);
    expect(nicknameSchema.safeParse("가".repeat(21)).success).toBe(false);
  });

  // Feature: personal-group-notifications, Property 1: 닉네임 정규화와 상태 보존
  // Validates: Requirements 1.3, 1.4, 1.9, 1.10, 1.11
  it("stores the normalized candidate only when its code-point length is valid", () => {
    fc.assert(
      fc.property(
        validNicknameCandidateArbitrary,
        fc.oneof(validNicknameCandidateArbitrary, invalidNicknameCandidateArbitrary),
        (existingNickname, candidate) => {
          const normalizedCandidate = normalizeNickname(candidate);
          const isValidCandidate =
            countUnicodeCodePoints(normalizedCandidate) >= 1 &&
            countUnicodeCodePoints(normalizedCandidate) <= 20;
          const result = nicknameSchema.safeParse(candidate);
          const storedNickname = result.success ? result.data : existingNickname;

          expect(isValidNickname(candidate)).toBe(isValidCandidate);
          expect(result.success).toBe(isValidCandidate);

          if (isValidCandidate) {
            expect(storedNickname).toBe(normalizedCandidate);
          } else {
            expect(storedNickname).toBe(existingNickname);
            expect(result.error?.issues[0]?.message).toBe(NICKNAME_ERROR_MESSAGE);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe("basic email validation and normalization", () => {
  it("accepts the basic format and returns a trimmed lowercase address", () => {
    const input = "  User.Name+Tag@Example.COM  ";

    expect(isBasicEmailFormat(input)).toBe(true);
    expect(normalizeEmail(input)).toBe("user.name+tag@example.com");
    expect(emailSchema.parse(input)).toBe("user.name+tag@example.com");
  });

  it.each([
    "userexample.com",
    "user@@example.com",
    "@example.com",
    "user@example",
    "user@.example.com",
    "user@example..com",
    "user@example.com.",
    "user name@example.com",
    "user@example .com",
  ])("rejects an invalid basic email: %s", (input) => {
    expect(isBasicEmailFormat(input)).toBe(false);
    expect(emailSchema.safeParse(input).success).toBe(false);
  });

  // Feature: personal-group-notifications, Property 3: 이메일 형식과 정규화의 일관성
  // Validates: Requirements 2.1, 2.2, 2.3
  it("keeps structural validation and case-and-whitespace normalization consistent", () => {
    const alphaNumericCharacters = [
      ..."abcdefghijklmnopqrstuvwxyz",
      ..."0123456789",
      "+",
      "-",
      "_",
    ] as const;
    const lowercaseCharacters = [..."abcdefghijklmnopqrstuvwxyz"] as const;
    const whitespace = fc
      .array(fc.constantFrom(" ", "\t", "\n", "\u00a0", "\u3000"), { maxLength: 3 })
      .map((characters) => characters.join(""));
    const fragment = fc
      .array(fc.constantFrom(...alphaNumericCharacters), { maxLength: 12 })
      .map((characters) => characters.join(""));
    const nonEmptyLowercaseFragment = fc
      .array(fc.constantFrom(...lowercaseCharacters), { minLength: 1, maxLength: 12 })
      .map((characters) => characters.join(""));

    const structuredInput = fc.record({
      leadingWhitespace: whitespace,
      localPart: fragment,
      whitespaceBeforeAt: whitespace,
      atCount: fc.integer({ min: 0, max: 3 }),
      whitespaceAfterAt: whitespace,
      domainLabels: fc.array(fragment, { maxLength: 4 }),
      trailingWhitespace: whitespace,
    });
    const validVariant = fc.record({
      localPart: nonEmptyLowercaseFragment,
      domainLabels: fc.array(nonEmptyLowercaseFragment, { minLength: 2, maxLength: 4 }),
      leadingWhitespace: whitespace,
      trailingWhitespace: whitespace,
      caseFlags: fc.array(fc.boolean(), { maxLength: 64 }),
    });

    fc.assert(
      fc.property(structuredInput, validVariant, (structured, variant) => {
        const candidate = `${structured.leadingWhitespace}${structured.localPart}${structured.whitespaceBeforeAt}${"@".repeat(structured.atCount)}${structured.whitespaceAfterAt}${structured.domainLabels.join(".")}${structured.trailingWhitespace}`;
        const trimmed = candidate.trim();
        const parts = trimmed.split("@");
        const expectedFormat =
          !/\s/u.test(trimmed) &&
          parts.length === 2 &&
          parts[0].length > 0 &&
          parts[1].length > 0 &&
          parts[1].split(".").length >= 2 &&
          parts[1].split(".").every((label) => label.length > 0);

        expect(isBasicEmailFormat(candidate)).toBe(expectedFormat);
        expect(emailSchema.safeParse(candidate).success).toBe(expectedFormat);

        const unformattedAddress = `${variant.localPart}@${variant.domainLabels.join(".")}`;
        const caseVariant = [...unformattedAddress]
          .map((character, index) =>
            variant.caseFlags[index] ? character.toUpperCase() : character.toLowerCase(),
          )
          .join("");
        const formattedVariant = `${variant.leadingWhitespace}${caseVariant}${variant.trailingWhitespace}`;

        expect(isBasicEmailFormat(formattedVariant)).toBe(true);
        expect(normalizeEmail(formattedVariant)).toBe(unformattedAddress);
        expect(emailSchema.parse(formattedVariant)).toBe(unformattedAddress);
      }),
      { numRuns: 100 },
    );
  });
});

describe("required group and notification text", () => {
  it("rejects empty and Unicode-whitespace-only group names", () => {
    expect(isNonBlankText("\u3000\u00a0\t")).toBe(false);
    expect(groupNameSchema.safeParse("").success).toBe(false);
    expect(groupNameSchema.safeParse("\u3000\u00a0\t").success).toBe(false);
  });

  // Feature: personal-group-notifications, Property 5: 공백 그룹 이름 거부
  // Validates: Requirements 3.4
  it("rejects every non-empty group name composed only of Unicode whitespace", () => {
    const unicodeWhitespace = [
      "\u0009",
      "\u000A",
      "\u000B",
      "\u000C",
      "\u000D",
      "\u0020",
      "\u00A0",
      "\u1680",
      "\u2000",
      "\u2001",
      "\u2002",
      "\u2003",
      "\u2004",
      "\u2005",
      "\u2006",
      "\u2007",
      "\u2008",
      "\u2009",
      "\u200A",
      "\u2028",
      "\u2029",
      "\u202F",
      "\u205F",
      "\u3000",
      "\uFEFF",
    ];

    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(...unicodeWhitespace), { minLength: 1, maxLength: 100 }),
        (characters) => {
          const input = characters.join("");

          expect(isNonBlankText(input)).toBe(false);
          expect(groupNameSchema.safeParse(input).success).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("rejects empty and Unicode-whitespace-only notification sentences", () => {
    expect(notificationSentenceSchema.safeParse("").success).toBe(false);
    expect(notificationSentenceSchema.safeParse("\u2003\n").success).toBe(false);
  });

  it("trims valid values without changing internal whitespace", () => {
    expect(groupNameSchema.parse("  운영 팀  ")).toBe("운영 팀");
    expect(notificationSentenceSchema.parse("\n  회의 자료를 확인해 주세요.  \t")).toBe(
      "회의 자료를 확인해 주세요.",
    );
  });
});
