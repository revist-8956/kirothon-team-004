"use client";

import { Button, ButtonLink, Skeleton, StatePanel } from "@/components/ui";

import { appRoutes } from "@/components/navigation";

export type RouteLoadingStateProps = {
  label?: string;
};

export function RouteLoadingState({ label = "정보를 불러오는 중" }: RouteLoadingStateProps) {
  return (
    <main className="app-content" aria-busy="true">
      <Skeleton label={label} lines={3} />
    </main>
  );
}

export type RouteErrorStateProps = {
  reset: () => void;
};

/** Keeps internal error details out of the route fallback while allowing a retry. */
export function RouteErrorState({ reset }: RouteErrorStateProps) {
  return (
    <main className="app-content">
      <StatePanel
        kind="error"
        title="정보를 불러오지 못했어요"
        description="잠시 후 다시 시도해 주세요."
        action={<Button onClick={reset}>다시 시도</Button>}
      />
    </main>
  );
}

export type RouteNotFoundStateProps = {
  href?: string;
  actionLabel?: string;
};

export function RouteNotFoundState({
  href = appRoutes.inbox,
  actionLabel = "받은 알림으로 이동",
}: RouteNotFoundStateProps) {
  return (
    <main className="app-content">
      <StatePanel
        kind="unavailable"
        title="요청한 정보를 찾을 수 없어요"
        description="정보를 다시 확인한 뒤 안전한 목록으로 이동해 주세요."
        action={<ButtonLink href={href}>{actionLabel}</ButtonLink>}
      />
    </main>
  );
}

/** Displays no protected notification or response information to an unauthorized viewer. */
export function RouteAccessDeniedState() {
  return (
    <main className="app-content">
      <StatePanel
        kind="forbidden"
        title="조회 권한 없음"
        description="현재 그룹 구성원만 이 정보를 볼 수 있어요."
        action={<ButtonLink href={appRoutes.inbox}>받은 알림으로 이동</ButtonLink>}
      />
    </main>
  );
}
