/** Contratos de respuesta compartidos entre la API y la app. */

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface AuthTokens {
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
  sessionId: string;
}

export interface UserDto {
  id: string;
  email: string;
  fullName: string;
  emailVerified: boolean;
  createdAt: string;
}

export interface AuthResponse {
  user: UserDto;
  tokens: AuthTokens;
}

export interface CompanySummaryDto {
  id: string;
  name: string;
  currency: string;
  timeZone: string;
  isDemo: boolean;
  role: { id: string; key: string | null; name: string };
}

export interface CompanyContextDto extends CompanySummaryDto {
  legalName: string | null;
  taxId: string | null;
  permissions: string[];
}

export interface SessionDto {
  id: string;
  deviceName: string | null;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  current: boolean;
}

export interface RoleDto {
  id: string;
  key: string | null;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissions: string[];
  /** Concurrencia optimista: se envía al editar. */
  version: number;
  /** Membresías activas con este rol. */
  memberCount: number;
}

export interface MemberDto {
  id: string;
  userId: string;
  email: string;
  fullName: string;
  status: 'ACTIVE' | 'REVOKED';
  role: { id: string; key: string | null; name: string };
  joinedAt: string;
}

export interface InvitationDto {
  id: string;
  email: string;
  role: { id: string; key: string | null; name: string };
  status: 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED';
  expiresAt: string;
  createdAt: string;
}

/** Valor de una métrica del dashboard: null mientras el módulo que la produce no exista. */
export interface MetricDto {
  value: string | null;
  status: 'CONFIRMED' | 'ESTIMATED' | 'NOT_AVAILABLE';
  note?: string;
}

export interface DashboardSummaryDto {
  company: { id: string; name: string };
  currency: string;
  period: {
    preset: string;
    timeZone: string;
    start: string;
    end: string;
    fromDate: string;
    toDate: string;
  };
  generatedAt: string;
  metrics: {
    /** Efectivo, bancos y billeteras al momento (no depende del periodo). */
    availableCash: MetricDto;
    /** Cobrado con terminal y aún no depositado: no es dinero disponible. */
    undeposited: MetricDto;
    income: MetricDto;
    expenses: MetricDto;
    netCashFlow: MetricDto;
    receivables: MetricDto;
    payables: MetricDto;
  };
  /** Movimientos capturados que esperan aprobación: no están incluidos en las cifras. */
  pendingReview: { count: number; income: string; expenses: string };
  team: { activeMembers: number; pendingInvitations: number };
}
