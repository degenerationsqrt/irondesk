import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/account/delete")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // Dynamic import keeps the service-role dependency inside the server handler.
        const { handleAccountDeletionRequest } = await import("@/lib/auth/account-deletion.server");
        return handleAccountDeletionRequest(request);
      },
    },
  },
});
