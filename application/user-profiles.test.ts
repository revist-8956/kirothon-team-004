import { describe, expect, it } from "vitest";

import { ApplicationError } from "./action-result";
import type {
  EnsureUserProfileInput,
  RepositoryTransaction,
  RepositoryUnitOfWork,
  UserRecord,
} from "./repositories";
import { deriveInitialProfile, prepareUserProfile } from "./user-profiles";

const AUTH_USER_ID = "00000000-0000-4000-8000-000000000001";

/** In-memory profile store with the same id and normalized-email uniqueness as PostgreSQL. */
function createProfileStore(initial: readonly UserRecord[] = []) {
  const profiles = new Map(initial.map((profile) => [profile.id, profile]));
  const ensured: EnsureUserProfileInput[] = [];

  const users = {
    findById: async (id: string) => profiles.get(id) ?? null,
    findByNormalizedEmail: async (emailNormalized: string) =>
      [...profiles.values()].find((profile) => profile.emailNormalized === emailNormalized) ?? null,
    ensureProfile: async (input: EnsureUserProfileInput) => {
      ensured.push(input);
      const emailTaken = [...profiles.values()].some(
        (profile) => profile.emailNormalized === input.emailNormalized && profile.id !== input.id,
      );
      if (!profiles.has(input.id) && !emailTaken) {
        const now = new Date();
        profiles.set(input.id, { ...input, createdAt: now, updatedAt: now });
      }
      return profiles.get(input.id) ?? null;
    },
    updateNickname: async () => null,
  };

  const repositories: RepositoryUnitOfWork = {
    transaction: (work) => work({ users } as unknown as RepositoryTransaction),
  };

  return { repositories, profiles, ensured };
}

function profile(overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    id: AUTH_USER_ID,
    email: "member@example.com",
    emailNormalized: "member@example.com",
    nickname: "직접 정한 닉네임",
    nicknameRequired: false,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

describe("deriveInitialProfile", () => {
  it("normalizes the Supabase email and uses the trimmed Google full name as the nickname", () => {
    expect(deriveInitialProfile({
      id: AUTH_USER_ID,
      email: "  Member@Example.COM ",
      userMetadata: { full_name: "  민수  ", name: "다른 이름" },
    })).toEqual({
      id: AUTH_USER_ID,
      email: "Member@Example.COM",
      emailNormalized: "member@example.com",
      nickname: "민수",
      nicknameRequired: false,
    });
  });

  it("falls back to the Google name and requires setup for an out-of-bounds or missing name", () => {
    expect(deriveInitialProfile({
      id: AUTH_USER_ID,
      email: "member@example.com",
      userMetadata: { full_name: "   ", name: "지은" },
    })).toMatchObject({ nickname: "지은", nicknameRequired: false });
    expect(deriveInitialProfile({
      id: AUTH_USER_ID,
      email: "member@example.com",
      userMetadata: { full_name: "😀".repeat(21) },
    })).toMatchObject({ nickname: "😀".repeat(21), nicknameRequired: true });
    expect(deriveInitialProfile({
      id: AUTH_USER_ID,
      email: "member@example.com",
      userMetadata: null,
    })).toMatchObject({ nickname: "", nicknameRequired: true });
  });

  it("rejects a Supabase user without a valid email address", () => {
    for (const email of [null, undefined, "not-an-email", "a@b", "a b@example.com"]) {
      expect(() => deriveInitialProfile({ id: AUTH_USER_ID, email })).toThrow(ApplicationError);
    }
  });
});

describe("prepareUserProfile", () => {
  it("returns an existing profile unchanged without creating another one", async () => {
    const existing = profile();
    const { repositories, ensured } = createProfileStore([existing]);

    await expect(prepareUserProfile(repositories, {
      id: AUTH_USER_ID,
      email: "MEMBER@example.com",
      userMetadata: { full_name: "Google 이름" },
    })).resolves.toEqual(existing);
    expect(ensured).toEqual([]);
  });

  it("creates the profile keyed by the Supabase user id when it is missing", async () => {
    const { repositories, profiles } = createProfileStore();

    const created = await prepareUserProfile(repositories, {
      id: AUTH_USER_ID,
      email: "Member@Example.com",
      userMetadata: { full_name: "민수" },
    });

    expect(created).toMatchObject({
      id: AUTH_USER_ID,
      emailNormalized: "member@example.com",
      nickname: "민수",
      nicknameRequired: false,
    });
    expect([...profiles.keys()]).toEqual([AUTH_USER_ID]);
  });

  it("reports a conflict when the normalized email belongs to another profile", async () => {
    const { repositories, profiles } = createProfileStore([
      profile({ id: "00000000-0000-4000-8000-000000000002" }),
    ]);

    await expect(prepareUserProfile(repositories, {
      id: AUTH_USER_ID,
      email: "member@EXAMPLE.com",
    })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(profiles.has(AUTH_USER_ID)).toBe(false);
  });
});
