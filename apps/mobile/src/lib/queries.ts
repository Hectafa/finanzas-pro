import type {
  CompanyContextDto,
  CompanySummaryDto,
  CreateCompanyInput,
  DashboardSummaryDto,
  InvitationDto,
  MemberDto,
  PeriodPreset,
  RoleDto,
  SessionDto,
  UserDto,
} from '@finanzas/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import { useSession } from './session';

/** Las claves incluyen la empresa activa para no mezclar datos al cambiar de empresa. */
const useCompanyKey = () => useSession((s) => s.companyId);

export function useMe() {
  return useQuery({ queryKey: ['me'], queryFn: () => api.request<UserDto>('/auth/me') });
}

export function useCompanies() {
  return useQuery({ queryKey: ['companies'], queryFn: () => api.request<CompanySummaryDto[]>('/companies') });
}

export function useCurrentCompany() {
  const companyId = useCompanyKey();
  return useQuery({
    queryKey: ['company', companyId],
    queryFn: () => api.request<CompanyContextDto>('/companies/current', { company: true }),
    enabled: !!companyId,
  });
}

export function useDashboard(period: PeriodPreset) {
  const companyId = useCompanyKey();
  return useQuery({
    queryKey: ['dashboard', companyId, period],
    queryFn: () => api.request<DashboardSummaryDto>('/dashboard/summary', { company: true, query: { period } }),
    enabled: !!companyId,
  });
}

export function useMembers(enabled: boolean) {
  const companyId = useCompanyKey();
  return useQuery({
    queryKey: ['members', companyId],
    queryFn: () => api.request<MemberDto[]>('/members', { company: true }),
    enabled: enabled && !!companyId,
  });
}

export function useInvitations(enabled: boolean) {
  const companyId = useCompanyKey();
  return useQuery({
    queryKey: ['invitations', companyId],
    queryFn: () => api.request<InvitationDto[]>('/invitations', { company: true }),
    enabled: enabled && !!companyId,
  });
}

export function useRoles(enabled: boolean) {
  const companyId = useCompanyKey();
  return useQuery({
    queryKey: ['roles', companyId],
    queryFn: () => api.request<RoleDto[]>('/roles', { company: true }),
    enabled: enabled && !!companyId,
  });
}

export function useSessions() {
  return useQuery({ queryKey: ['sessions'], queryFn: () => api.request<SessionDto[]>('/auth/sessions') });
}

export function useCreateCompany() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCompanyInput) => api.request<CompanySummaryDto>('/companies', { method: 'POST', body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['companies'] }),
  });
}

export function useInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { email: string; roleId: string }) =>
      api.request<InvitationDto>('/invitations', { method: 'POST', body: input, company: true }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['invitations'] }),
  });
}

export function useRevokeInvitation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.request<void>(`/invitations/${id}/revoke`, { method: 'POST', company: true }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['invitations'] }),
  });
}

export function useSetMemberStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      api.request<void>(`/members/${id}/${active ? 'reactivate' : 'revoke'}`, { method: 'POST', company: true }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['members'] }),
  });
}

export function useRevokeSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.request<void>(`/auth/sessions/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sessions'] }),
  });
}
