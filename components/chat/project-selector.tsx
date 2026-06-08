"use client";

import {
  FolderIcon,
  FolderPlusIcon,
  PencilIcon,
  PlugIcon,
  TrashIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { useProjects } from "@/hooks/use-projects";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "../ui/sidebar";
import { McpSettingsDialog } from "./mcp-settings-dialog";

function endpoint(path: string) {
  return `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}${path}`;
}

export function ProjectSelector() {
  const router = useRouter();
  const {
    isLoading,
    projects,
    refreshProjects,
    selectedProject,
    selectedProjectId,
    setSelectedProjectId,
  } = useProjects();
  const [isMcpOpen, setIsMcpOpen] = useState(false);
  const [projectDialogMode, setProjectDialogMode] = useState<
    "create" | "rename" | null
  >(null);
  const [projectName, setProjectName] = useState("");
  const [isSavingProject, setIsSavingProject] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);

  const selectProject = (projectId: string | null) => {
    setSelectedProjectId(projectId);
    router.push("/");
  };

  const openProjectDialog = (mode: "create" | "rename") => {
    setProjectDialogMode(mode);
    setProjectName(mode === "rename" ? (selectedProject?.name ?? "") : "");
  };

  const saveProjectDialog = async () => {
    const name = projectName.trim();

    if (!name) {
      return;
    }

    setIsSavingProject(true);

    try {
      const response =
        projectDialogMode === "rename" && selectedProject
          ? await fetch(endpoint(`/api/projects/${selectedProject.id}`), {
              method: "PATCH",
              body: JSON.stringify({ name }),
            })
          : await fetch(endpoint("/api/projects"), {
              method: "POST",
              body: JSON.stringify({ name }),
            });
      const result = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(result?.cause || result?.message || "Save failed");
      }

      refreshProjects();
      if (projectDialogMode === "create") {
        selectProject(result.project.id);
      }
      setProjectDialogMode(null);
      toast.success(
        projectDialogMode === "rename" ? "Project renamed" : "Project created"
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to save project."
      );
    } finally {
      setIsSavingProject(false);
    }
  };

  const deleteSelectedProject = async () => {
    if (!selectedProject) {
      return;
    }

    try {
      const response = await fetch(
        endpoint(`/api/projects/${selectedProject.id}`),
        { method: "DELETE" }
      );
      const result = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(result?.cause || result?.message || "Delete failed");
      }

      refreshProjects();
      selectProject(null);
      setIsDeleteOpen(false);
      toast.success("Project deleted");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to delete project."
      );
    }
  };

  return (
    <>
      <SidebarGroup className="pt-1 group-data-[collapsible=icon]:hidden">
        <SidebarGroupLabel className="text-[10px] font-semibold uppercase tracking-[0.12em] text-sidebar-foreground/70">
          Scope
        </SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            <SidebarMenuItem>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <SidebarMenuButton
                    className="h-8 rounded-lg border border-sidebar-border text-[13px] text-sidebar-foreground/70"
                    data-testid="project-selector"
                  >
                    <FolderIcon className="size-4" />
                    <span className="truncate font-medium">
                      {isLoading
                        ? "Loading..."
                        : (selectedProject?.name ?? "Standalone")}
                    </span>
                  </SidebarMenuButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-64">
                  <DropdownMenuLabel>Scope</DropdownMenuLabel>
                  <DropdownMenuRadioGroup
                    onValueChange={(value) =>
                      selectProject(value === "standalone" ? null : value)
                    }
                    value={selectedProjectId ?? "standalone"}
                  >
                    <DropdownMenuRadioItem value="standalone">
                      Standalone
                    </DropdownMenuRadioItem>
                    {projects.map((project) => (
                      <DropdownMenuRadioItem
                        key={project.id}
                        value={project.id}
                      >
                        <span className="truncate">{project.name}</span>
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={() => openProjectDialog("create")}
                  >
                    <FolderPlusIcon className="size-4" />
                    New project
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={!selectedProject}
                    onSelect={() => openProjectDialog("rename")}
                  >
                    <PencilIcon className="size-4" />
                    Rename project
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setIsMcpOpen(true)}>
                    <PlugIcon className="size-4" />
                    MCP settings
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={!selectedProject}
                    onSelect={() => setIsDeleteOpen(true)}
                    variant="destructive"
                  >
                    <TrashIcon className="size-4" />
                    Delete project
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>

      <McpSettingsDialog
        onOpenChange={setIsMcpOpen}
        open={isMcpOpen}
        projectId={selectedProjectId}
      />

      <Dialog
        onOpenChange={(open) => {
          if (!open) {
            setProjectDialogMode(null);
          }
        }}
        open={projectDialogMode !== null}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {projectDialogMode === "rename"
                ? "Rename Project"
                : "New Project"}
            </DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            onChange={(event) => setProjectName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                saveProjectDialog();
              }
            }}
            placeholder="Project name"
            value={projectName}
          />
          <DialogFooter showCloseButton>
            <Button
              disabled={isSavingProject || !projectName.trim()}
              onClick={saveProjectDialog}
              type="button"
            >
              {projectDialogMode === "rename" ? "Rename" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog onOpenChange={setIsDeleteOpen} open={isDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Project?</AlertDialogTitle>
            <AlertDialogDescription>
              This deletes the project, its conversations, and its project
              workspace.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={deleteSelectedProject}
              variant="destructive"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
