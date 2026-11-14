import type { ReactNode } from "react";

import { NavigationHeader } from "@/components/ui";

import { appRoutes } from "./routes";

const tabs = [
  { id: "inbox", label: "받은 알림", href: appRoutes.inbox },
  { id: "sent", label: "보낸 알림", href: appRoutes.sent },
  { id: "friends", label: "친구", href: appRoutes.friends },
  { id: "groups", label: "그룹", href: appRoutes.groups },
] as const;

export type ProtectedTab = (typeof tabs)[number]["id"];

export type BottomTabBarProps = {
  current: ProtectedTab;
};

export function BottomTabBar({ current }: BottomTabBarProps) {
  return (
    <nav className="app-tab-bar" aria-label="주요 메뉴">
      {tabs.map((tab) => (
        <a href={tab.href} aria-current={tab.id === current ? "page" : undefined} key={tab.id}>
          {tab.label}
        </a>
      ))}
    </nav>
  );
}

export type TabbedPageLayoutProps = {
  current: ProtectedTab;
  children: ReactNode;
};

/** Applies the fixed primary navigation and matching scroll clearance to a list route. */
export function TabbedPageLayout({ current, children }: TabbedPageLayoutProps) {
  return (
    <>
      <main className="app-content app-content--with-tabs">{children}</main>
      <div className="app-bottom">
        <BottomTabBar current={current} />
      </div>
    </>
  );
}

export type ComposeHeaderProps = {
  step?: "1 / 2" | "2 / 2";
  backTo?: string;
};

/** Header for compose routes. Step one closes to the inbox; step two returns to compose. */
export function ComposeHeader({ step = "1 / 2", backTo }: ComposeHeaderProps) {
  const isSchedule = step === "2 / 2";

  return (
    <NavigationHeader
      title={isSchedule ? "언제 보낼까요?" : "새 알림"}
      href={backTo ?? (isSchedule ? appRoutes.composePersonal : appRoutes.inbox)}
      navigationLabel={isSchedule ? "알림 작성으로 돌아가기" : "알림 작성을 닫고 받은 알림으로"}
      kind={isSchedule ? "back" : "close"}
      step={step}
    />
  );
}

export function GroupDetailHeader({ title }: { title: ReactNode }) {
  return (
    <NavigationHeader
      title={title}
      href={appRoutes.groups}
      navigationLabel="그룹 목록으로 돌아가기"
    />
  );
}
