import { RouteNotFoundState } from "@/components/states";

import { appRoutes } from "@/components/navigation";

export default function ScheduleNotFound() {
  return <RouteNotFoundState href={appRoutes.composePersonal} actionLabel="알림 작성으로 이동" />;
}
