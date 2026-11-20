import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import fc from "fast-check";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { findNonCanonicalServiceNames } from "@/tests/support/brand";

const testState = vi.hoisted(() => ({
  inbox: { cards: [] as unknown[], unconfirmedCount: 0 },
  sent: [] as unknown[],
  friends: [] as unknown[],
  groups: [] as unknown[],
}));

vi.mock("@/application/authentication", () => ({
  requireUser: async () => ({ id: "u", nickname: "민수", nicknameRequired: false }),
}));
vi.mock("@/application/inbox", () => ({ getInbox: async () => testState.inbox }));
vi.mock("@/application/notification-status", () => ({ getSentNotifications: async () => testState.sent }));
vi.mock("@/application/friends", () => ({ getFriends: async () => testState.friends }));
vi.mock("@/application/group-queries", () => ({ getGroups: async () => testState.groups }));
vi.mock("@/infrastructure/prisma-repositories", () => ({ repositories: {} }));
vi.mock("@/app/actions/inbox", () => ({ confirmDispatchAction: vi.fn() }));
vi.mock("@/app/actions/sent", () => ({ stopRecurringNotificationAction: vi.fn() }));
vi.mock("@/app/actions/friends", () => ({ addFriend: vi.fn() }));
vi.mock("@/app/actions/groups", () => ({ createGroupAction: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), redirect: vi.fn() }));

import FriendsRoute from "./friends/page";
import GroupsPage from "./groups/page";
import InboxPage from "./inbox/page";
import SentPage from "./sent/page";

const INTERNAL_ROUTES = [
  { name: "inbox", page: InboxPage, heading: "받은 알림", tab: "받은 알림" },
  { name: "sent", page: SentPage, heading: "보낸 알림", tab: "보낸 알림" },
  { name: "friends", page: FriendsRoute, heading: "친구", tab: "친구" },
  { name: "groups", page: GroupsPage, heading: undefined, tab: "그룹" },
] as const;

const sampleCard = {
  dispatchId: "d1",
  notificationId: "n1",
  sentence: "저녁 약 챙겨 먹기",
  mode: "PERSONAL",
  groupName: null,
  senderNickname: "엄마",
  scheduleKind: "ONE_TIME",
  recurrence: null,
  sequence: 1,
  sentAt: new Date("2026-11-19T12:00:00.000Z"),
  confirmedAt: null,
};

async function renderRoute(route: (typeof INTERNAL_ROUTES)[number]) {
  const element = (await (route.page as () => Promise<ReactNode>)()) as ReactNode;
  return render(<>{element}</>);
}

describe("internal pages keep their own structure", () => {
  // Feature: service-rebrand-ui, Property 6: 내부 페이지의 기존 시작 구조 유지
  // **Validates: Requirements 5.5, 5.7**
  it("Property 6: no internal page gets a brand header, and each starts with its feature content", async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...INTERNAL_ROUTES), fc.boolean(), async (route, withData) => {
        testState.inbox = withData ? { cards: [sampleCard], unconfirmedCount: 1 } : { cards: [], unconfirmedCount: 0 };
        testState.friends = withData ? [{ nickname: "지수", email: "jisu@example.test" }] : [];
        const { container } = await renderRoute(route);
        try {
          expect(container.querySelector("[data-brand-container]")).toBeNull();
          expect(screen.queryByText("했냥?")).toBeNull();
          expect(screen.queryAllByRole("banner").filter((banner) => /했냥/u.test(banner.textContent ?? ""))).toEqual([]);
          const main = container.querySelector("main")!;
          const firstChild = main.firstElementChild!;
          expect(firstChild.textContent).not.toMatch(/했냥/u);
          if (route.heading) {
            expect(main.querySelector("h1")).toHaveTextContent(route.heading);
            expect(firstChild.contains(main.querySelector("h1"))).toBe(true);
          }
          expect(screen.getByRole("navigation", { name: "주요 메뉴" })).toBeVisible();
          expect(screen.getByRole("link", { name: route.tab })).toHaveAttribute("aria-current", "page");
        } finally {
          cleanup();
        }
      }),
      { numRuns: 100 },
    );
  });

  it("keeps the inbox, sent and friends headings", async () => {
    for (const route of INTERNAL_ROUTES.filter((candidate) => candidate.heading)) {
      await renderRoute(route);
      expect(screen.getByRole("heading", { level: 1, name: route.heading })).toBeVisible();
      cleanup();
    }
  });
});

/** User-facing source files: routes and components, without tests. */
function userFacingSources(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return userFacingSources(path);
    return /\.tsx?$/u.test(entry) && !/\.test\.tsx?$/u.test(entry) ? [path] : [];
  });
}

describe("remaining service names", () => {
  it("has no previous name and no bare 했냥 in any rendered string", () => {
    const root = process.cwd();
    for (const file of [...userFacingSources(join(root, "app")), ...userFacingSources(join(root, "components"))]) {
      const source = readFileSync(file, "utf8");
      const strings = [...source.matchAll(/"([^"\n]*)"|'([^'\n]*)'|`([^`]*)`|>([^<>{}\n]+)</gu)].map(
        (match) => match[1] ?? match[2] ?? match[3] ?? match[4] ?? "",
      );
      for (const text of strings) {
        expect(findNonCanonicalServiceNames(text), `${file}: ${text}`).toEqual([]);
      }
    }
  });

  it("shows the brand only on the entry screens", () => {
    const root = process.cwd();
    const users = [...userFacingSources(join(root, "app")), ...userFacingSources(join(root, "components"))]
      .filter((file) => readFileSync(file, "utf8").includes("BrandIdentity"))
      .map((file) => file.slice(root.length + 1))
      .sort();
    expect(users).toEqual([
      "app/login/page.tsx",
      "app/profile/setup/page.tsx",
      "components/BrandIdentity.tsx",
    ]);
  });
});
