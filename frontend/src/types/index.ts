// Tipos compartidos. Coinciden con los esquemas de FastAPI (app/schemas/dashboard.py).

export type ProjectStatus = 'planning' | 'active' | 'paused' | 'closed';
export type SprintStatus = 'planned' | 'active' | 'closed' | 'cancelled';
export type ProjectRole = 'product_owner' | 'scrum_master' | 'developer' | 'observer';

export interface AppUser {
  id: string;
  email: string;
  fullName: string;
  avatarUrl?: string | null;
  role?: ProjectRole;
}

export interface Stat {
  value: number;
  delta: number;
  deltaKind: 'absolute' | 'percent';
  trend: number[];
}

export interface DashboardStats {
  activeProjects: Stat;
  sprintsInProgress: Stat;
  completedTasks: Stat;
  teamMembers: Stat;
}

export interface MemberMini {
  id: string;
  name: string;
  avatarUrl?: string | null;
}

export interface ProjectSummary {
  id: string;
  name: string;
  color: string;
  status: ProjectStatus;
  sprintNumber: number | null;
  sprintDays: number | null;
  progress: number;
  members: MemberMini[];
  extraMembers: number;
}

export interface CurrentSprint {
  id: string;
  projectId: string;
  projectName: string;
  number: number;
  startDate: string;
  endDate: string;
  workingDays: number;
  goal: string;
  progress: number;
  status: SprintStatus;
}

export type ActivityKind = 'move' | 'comment' | 'create' | 'label' | 'update' | 'other';

export interface ActivityItem {
  id: number;
  actorName: string;
  message: string;
  highlight?: string | null;
  kind: ActivityKind;
  createdAt: string;
}

export interface BurndownPoint {
  label: string;
  ideal: number;
  real: number | null;
}

export interface Burndown {
  sprintId: string;
  sprintLabel: string;
  points: BurndownPoint[];
}

export interface DashboardData {
  stats: DashboardStats;
  projects: ProjectSummary[];
  currentSprint: CurrentSprint | null;
  activity: ActivityItem[];
  burndown: Burndown | null;
  unreadNotifications: number;
}
