"use client";

import { FolderIcon } from "lucide-react";
import { useProjects } from "@/hooks/use-projects";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "../ui/sidebar";

export function ProjectSelector() {
  const { isLoading } = useProjects();

  return (
    <SidebarGroup className="pt-1 group-data-[collapsible=icon]:hidden">
      <SidebarGroupLabel className="text-[10px] font-semibold uppercase tracking-[0.12em] text-sidebar-foreground/70">
        Scope
      </SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              className="h-8 rounded-lg border border-sidebar-border text-[13px] text-sidebar-foreground/70"
              data-testid="project-selector"
            >
              <FolderIcon className="size-4" />
              <span className="font-medium">
                {isLoading ? "Loading..." : "All conversations"}
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
