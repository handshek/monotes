import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";

/**
 * Hook to search user's cloud notes
 */
export function useSearchCloudNotes(searchQuery: string | undefined) {
  return useQuery(
    api.notes.searchNotes,
    searchQuery ? { searchQuery } : "skip"
  );
}
