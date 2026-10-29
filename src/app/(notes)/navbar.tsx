"use client";

import { Button } from "@/components/sodium/ui/button";
import { ButtonGroup, ButtonGroupSeparator } from "@/components/sodium/ui/button-group";
import { Icon, Add, SidebarToggle } from "@/components/sodium/icon";
import { toast } from "@/components/sodium/ui/toast";
import ThemeToggeler from "@/components/theme-toggeler";
import { useRouter } from "next/navigation";
import { createNewNote } from "@/lib/local-notes";
import { generateSlug } from "@/lib/ids";
import { useSidebar } from "@/components/sidebar";
import SettingsTrigger from "@/components/settings/settings-trigger";
import { useDistractionFree } from "@/contexts/distraction-free-context";
import { useEffect } from "react";
import { cn } from "@/lib/sodium/utils";

export default function Navbar() {
  const router = useRouter();
  const { toggleSidebar, isMobile, open } = useSidebar();
  const { isDistracted, resetDistraction } = useDistractionFree();

  const onCreateNew = async () => {
    try {
      const slug = generateSlug();
      const note = await createNewNote(slug);
      router.push(`/${note.id}`);
    } catch {
      toast.fail("Could not create note. Please try again.");
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
        "fixed start-0 top-0 flex w-full items-center justify-between p-2 transition-opacity duration-(--dur-overlay) ease-out",
        isDistracted ? "opacity-15" : "opacity-100",
      )}
    >
      {/* With the desktop sidebar open it sits over this spot and carries its own toggle. */}
      {(isMobile || !open) && (
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleSidebar}
          aria-label="Toggle sidebar"
        >
          <Icon icon={SidebarToggle} />
        </Button>
      )}

      <ButtonGroup aria-label="Note actions" className="ms-auto">
        <Button
          variant="ghost"
          size="icon"
          aria-label="New note"
          onClick={onCreateNew}
        >
          <Icon icon={Add} />
        </Button>
        <ButtonGroupSeparator />
        <SettingsTrigger />
        <ButtonGroupSeparator />
        <ThemeToggeler />
      </ButtonGroup>
    </nav>
  );
}
