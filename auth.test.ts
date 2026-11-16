import { beforeEach, describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => ({
  nextAuth: vi.fn(),
  google: { id: "google" },
  findUnique: vi.fn(),
  loggerInfo: vi.fn(),
}));

vi.mock("next-auth", () => ({
  default: testState.nextAuth,
}));

vi.mock("next-auth/providers/google", () => ({
  default: testState.google,
}));

vi.mock("./infrastructure/db", () => ({
  prisma: { user: { findUnique: testState.findUnique } },
}));

vi.mock("./infrastructure/logger", () => ({
  logger: { info: testState.loggerInfo },
}));

type AuthConfiguration = {
  adapter?: unknown;
  session: { strategy: string };
  providers: unknown[];
  callbacks: {
    signIn: (input: {
      account?: { provider?: string };
      profile?: { email?: unknown; email_verified?: unknown };
    }) => boolean;
    jwt: (input: {
      token: Record<string, unknown>;
      profile?: { email?: unknown };
    }) => Promise<Record<string, unknown>>;
    session: (input: {
      session: { user?: { name?: string | null; email?: string | null } };
      token: Record<string, unknown>;
    }) => { user: { id: string } };
  };
};

async function loadConfiguration(): Promise<AuthConfiguration> {
  await import("./auth");
  return testState.nextAuth.mock.calls[0]?.[0] as AuthConfiguration;
}

beforeEach(() => {
  vi.resetModules();
  testState.nextAuth.mockReset();
  testState.findUnique.mockReset();
  testState.loggerInfo.mockReset();
  testState.nextAuth.mockReturnValue({
    handlers: {},
    auth: vi.fn(),
    signIn: vi.fn(),
    signOut: vi.fn(),
  });
});

describe("Auth.js Google callback configuration", () => {
  it("accepts only verified Google callbacks and rejects failed or cancelled callback profiles", async () => {
    const configuration = await loadConfiguration();

    expect(configuration.callbacks.signIn({
      account: { provider: "google" },
      profile: { email: "member@example.com", email_verified: true },
    })).toBe(true);
    expect(configuration.callbacks.signIn({
      account: { provider: "google" },
      profile: { email: "member@example.com", email_verified: false },
    })).toBe(false);
    expect(configuration.callbacks.signIn({
      account: { provider: "google" },
      profile: undefined,
    })).toBe(false);
    expect(configuration.callbacks.signIn({
      account: { provider: "credentials" },
      profile: { email: "member@example.com", email_verified: true },
    })).toBe(false);
  });

  it("uses Google only without the removed Auth.js database adapter", async () => {
    const configuration = await loadConfiguration();

    expect(configuration.adapter).toBeUndefined();
    expect(configuration.session).toEqual({ strategy: "jwt" });
    expect(configuration.providers).toEqual([testState.google]);
  });

  it("resolves the Supabase-keyed profile by normalized email and exposes only its id", async () => {
    const configuration = await loadConfiguration();
    testState.findUnique.mockResolvedValue({ id: "00000000-0000-4000-8000-000000000001" });

    const token = await configuration.callbacks.jwt({
      token: { sub: "google-subject" },
      profile: { email: "  Member@Example.COM " },
    });

    expect(testState.findUnique).toHaveBeenCalledWith({
      where: { emailNormalized: "member@example.com" },
      select: { id: true },
    });
    expect(configuration.callbacks.session({
      session: { user: { name: "민수", email: "member@example.com" } },
      token,
    }).user).toEqual({
      name: "민수",
      email: "member@example.com",
      id: "00000000-0000-4000-8000-000000000001",
    });
  });

  it("leaves the session without a user id when no application profile exists", async () => {
    const configuration = await loadConfiguration();
    testState.findUnique.mockResolvedValue(null);

    const token = await configuration.callbacks.jwt({
      token: { sub: "google-subject" },
      profile: { email: "new@example.com" },
    });

    expect(configuration.callbacks.session({ session: { user: {} }, token }).user.id).toBe("");
  });
});
