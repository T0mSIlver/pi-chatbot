"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import useSWR from "swr";
import type { Project } from "@/lib/db/schema";
import { fetcher } from "@/lib/utils";

type ProjectsContextValue = {
  projects: Project[];
  selectedProjectId: string | null;
  selectedProject: Project | null;
  setSelectedProjectId: (id: string) => void;
  refreshProjects: () => void;
  isLoading: boolean;
};

const ProjectsContext = createContext<ProjectsContextValue | null>(null);
const SELECTED_PROJECT_STORAGE_KEY = "selected-project-id:local-network";

export function ProjectProvider({
  children,
  enabled,
}: {
  children: ReactNode;
  enabled: boolean;
}) {
  const { data, mutate, isLoading } = useSWR<{ projects: Project[] }>(
    enabled ? `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/projects` : null,
    fetcher,
    { revalidateOnFocus: false }
  );
  const projects = data?.projects ?? [];
  const [selectedProjectId, setSelectedProjectIdState] = useState<
    string | null
  >(null);

  useEffect(() => {
    const stored = window.localStorage.getItem(SELECTED_PROJECT_STORAGE_KEY);
    if (stored) {
      setSelectedProjectIdState(stored);
    }
  }, []);

  useEffect(() => {
    if (projects.length === 0) {
      return;
    }

    if (
      !selectedProjectId ||
      !projects.some((p) => p.id === selectedProjectId)
    ) {
      const nextId = projects[0].id;
      setSelectedProjectIdState(nextId);
      window.localStorage.setItem(SELECTED_PROJECT_STORAGE_KEY, nextId);
    }
  }, [projects, selectedProjectId]);

  const setSelectedProjectId = useCallback((id: string) => {
    setSelectedProjectIdState(id);
    window.localStorage.setItem(SELECTED_PROJECT_STORAGE_KEY, id);
  }, []);

  const selectedProject =
    projects.find((project) => project.id === selectedProjectId) ??
    projects[0] ??
    null;

  const value = useMemo<ProjectsContextValue>(
    () => ({
      projects,
      selectedProjectId: selectedProject?.id ?? selectedProjectId,
      selectedProject,
      setSelectedProjectId,
      refreshProjects: () => {
        mutate();
      },
      isLoading,
    }),
    [
      projects,
      selectedProjectId,
      selectedProject,
      mutate,
      isLoading,
      setSelectedProjectId,
    ]
  );

  return (
    <ProjectsContext.Provider value={value}>
      {children}
    </ProjectsContext.Provider>
  );
}

export function useProjects() {
  const context = useContext(ProjectsContext);
  if (!context) {
    throw new Error("useProjects must be used within ProjectProvider");
  }
  return context;
}
