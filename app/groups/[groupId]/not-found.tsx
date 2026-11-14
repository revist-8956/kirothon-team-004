import { RouteNotFoundState } from "@/components/states";

import { appRoutes } from "@/components/navigation";

export default function GroupDetailNotFound() {
  return <RouteNotFoundState href={appRoutes.groups} actionLabel="그룹 목록으로 이동" />;
}
