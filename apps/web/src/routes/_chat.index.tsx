import { createFileRoute } from "@tanstack/react-router";

import { PresenceDashboard } from "../components/presence/PresenceDashboard";

function ChatIndexRouteView() {
  return <PresenceDashboard />;
}

export const Route = createFileRoute("/_chat/")({
  component: ChatIndexRouteView,
});
