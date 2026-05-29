"use client";

import { FolderIcon, MoreHorizontalIcon, PlusIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { mutate as globalMutate } from "swr";
import { useProjects } from "@/hooks/use-projects";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "../ui/sidebar";

export function ProjectSelector() {
  const router = useRouter();
  const {
    projects,
    selectedProject,
    selectedProjectId,
    setSelectedProjectId,
    refreshProjects,
    isLoading,
  } = useProjects();

  const refreshHistory = () => {
    globalMutate(
      (key) => typeof key === "string" && key.includes("/api/history")
    );
  };

  const selectProject = (id: string) => {
    setSelectedProjectId(id);
    router.push("/");
    refreshHistory();
  };

  const createProject = async () => {
    // biome-ignore lint/suspicious/noAlert: v1 uses a minimal native prompt for project CRUD.
    const name = window.prompt("Project name");
    if (!name?.trim()) {
      return;
    }

    const response = await fetch(
      `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/projects`,
      {
        method: "POST",
        body: JSON.stringify({ name: name.trim() }),
      }
    );

    if (!response.ok) {
      toast.error("Failed to create project");
      return;
    }

    const { project } = await response.json();
    refreshProjects();
    selectProject(project.id);
  };

  const renameProject = async () => {
    if (!selectedProject) {
      return;
    }

    // biome-ignore lint/suspicious/noAlert: v1 uses a minimal native prompt for project CRUD.
    const name = window.prompt("Project name", selectedProject.name);
    if (!name?.trim()) {
      return;
    }

    const response = await fetch(
      `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/projects/${selectedProject.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({ name: name.trim() }),
      }
    );

    if (!response.ok) {
      toast.error("Failed to rename project");
      return;
    }

    refreshProjects();
  };

  const deleteProject = async () => {
    if (!selectedProject) {
      return;
    }

    // biome-ignore lint/suspicious/noAlert: v1 uses a minimal native confirm for project CRUD.
    if (!window.confirm(`Delete project "${selectedProject.name}"?`)) {
      return;
    }

    const response = await fetch(
      `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/projects/${selectedProject.id}`,
      { method: "DELETE" }
    );

    if (!response.ok) {
      toast.error("Failed to delete project");
      return;
    }

    refreshProjects();
    router.push("/");
    refreshHistory();
  };

  return (
    <SidebarGroup className="pt-1 group-data-[collapsible=icon]:hidden">
      <SidebarGroupLabel className="text-[10px] font-semibold uppercase tracking-[0.12em] text-sidebar-foreground/70">
        Projects
      </SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton
                  className="h-8 rounded-lg border border-sidebar-border text-[13px] text-sidebar-foreground/70 transition-colors duration-150 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                  data-testid="project-selector"
                >
                  <FolderIcon className="size-4" />
                  <span className="font-medium">
                    {isLoading
                      ? "Loading..."
                      : (selectedProject?.name ?? "Project")}
                  </span>
                  <MoreHorizontalIcon className="ml-auto size-4 text-sidebar-foreground/40" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" side="bottom">
                {projects.map((project) => (
                  <DropdownMenuItem
                    key={project.id}
                    onClick={() => selectProject(project.id)}
                  >
                    <FolderIcon className="size-4" />
                    <span
                      className={
                        project.id === selectedProjectId ? "font-medium" : ""
                      }
                    >
                      {project.name}
                    </span>
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={createProject}>
                  <PlusIcon className="size-4" />
                  <span>New project</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={!selectedProject}
                  onClick={renameProject}
                >
                  Rename project
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={!selectedProject}
                  onClick={deleteProject}
                  variant="destructive"
                >
                  Delete project
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
