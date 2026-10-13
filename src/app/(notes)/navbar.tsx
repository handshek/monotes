"use client";

import { Button } from "@/components/ui/button";
import {
  ButtonGroup,
  ButtonGroupSeparator,
} from "@/components/ui/button-group";
import { PlusIcon, HamburgerMenuIcon } from "@radix-ui/react-icons";
import ThemeToggeler from "@/components/theme-toggeler";
import { useRouter } from "next/navigation";
import { createNewNote } from "@/lib/local-notes";
import { generateSlug } from "@/lib/ids";
import { toast } from "sonner";
import { useSidebar } from "@/components/ui/sidebar";
import SettingsTrigger from "@/components/settings/settings-trigger";
import { useDistractionFree } from "@/contexts/distraction-free-context";
import { useEffect } from "react";
import { cn } from "@/lib/utils";

export default function Navbar() {
  const router = useRouter();
  const { toggleSidebar } = useSidebar();
  const { isDistracted, resetDistraction } = useDistractionFree();

  const onCreateNew = async () => {
    try {
      const slug = generateSlug();
      const note = await createNewNote(slug);
      router.push(`/${note.id}`);
    } catch {
      toast.error("Could not create note. Please try again.");
    }
  };

  useEffect(() => {
    const handleMouseMove = () => {
      resetDistraction();
    };

    document.addEventListener("mousemove", handleMouseMove);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
    };
  }, [resetDistraction]);

  return (
    <nav
      className={cn(
        "flex items-center justify-between fixed top-0 left-0 w-full p-2 transition-opacity duration-300",
        isDistracted ? "opacity-15" : "opacity-100",
      )}
    >
      <Button
        variant="outline"
        size="icon-lg"
        onClick={toggleSidebar}
        aria-label="Toggle sidebar"
      >
        <HamburgerMenuIcon className="size-4" />
      </Button>

      <ButtonGroup className="rounded-inherit">
        <Button
          variant="outline"
          size="icon-lg"
          aria-label="New note"
          onClick={onCreateNew}
        >
          <PlusIcon className="size-4" />
        </Button>
        <ButtonGroupSeparator />
        <SettingsTrigger />
        <ButtonGroupSeparator />
        <ThemeToggeler />
      </ButtonGroup>
    </nav>
  );
}
