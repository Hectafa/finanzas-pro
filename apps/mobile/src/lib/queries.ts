import type {
  CategoryDto,
  CompanyContextDto,
  CompanySummaryDto,
  CreateCategoryInput,
  CreateCompanyInput,
  CreateFinancialAccountInput,
  CreateRoleInput,
  CreateTransactionInput,
  DashboardSummaryDto,
  FinancialAccountDto,
  InvitationDto,
  ListTransactionsQuery,
  MemberDto,
  PeriodPreset,
  RoleDto,
  SessionDto,
  TransactionDto,
  TransactionPageDto,
  UpdateCategoryInput,
  UpdateFinancialAccountInput,
  UpdateRoleInput,
  UpdateTransactionInput,
  UserDto,
} from '@finanzas/shared';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import { useSession } from './session';

/** Las claves incluyen la empresa activa para no mezclar datos al cambiar de empresa. */
const useCompanyKey = () => useSession((s) => s.companyId);

export function useMe() {
  return useQuery({ queryKey: ['me'], queryFn: () => api.request<UserDto>('/auth/me') });
}

export function useCompanies() {
  return useQuery({
    queryKey: ['companies'],
    queryFn: () => api.request<CompanySummaryDto[]>('/companies'),
  });
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
    queryFn: () =>
      api.request<DashboardSummaryDto>('/dashboard/summary', { company: true, query: { period } }),
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
  return useQuery({
    queryKey: ['sessions'],
    queryFn: () => api.request<SessionDto[]>('/auth/sessions'),
  });
}

export function useCreateCompany() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCompanyInput) =>
      api.request<CompanySummaryDto>('/companies', { method: 'POST', body: input }),
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
    mutationFn: (id: string) =>
      api.request<void>(`/invitations/${id}/revoke`, { method: 'POST', company: true }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['invitations'] }),
  });
}

export function useSetMemberStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      api.request<void>(`/members/${id}/${active ? 'reactivate' : 'revoke'}`, {
        method: 'POST',
        company: true,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['members'] }),
  });
}

/** Un cambio de rol afecta la lista de roles y los nombres de rol que muestran miembros e invitaciones. */
function useInvalidateRoles() {
  const qc = useQueryClient();
  return () =>
    Promise.all(
      ['roles', 'members', 'invitations'].map((key) => qc.invalidateQueries({ queryKey: [key] })),
    );
}

export function useCreateRole() {
  const invalidate = useInvalidateRoles();
  return useMutation({
    mutationFn: (input: CreateRoleInput) =>
      api.request<RoleDto>('/roles', { method: 'POST', body: input, company: true }),
    onSuccess: invalidate,
  });
}

export function useUpdateRole() {
  const invalidate = useInvalidateRoles();
  return useMutation({
    mutationFn: ({ id, ...input }: UpdateRoleInput & { id: string }) =>
      api.request<RoleDto>(`/roles/${id}`, { method: 'PATCH', body: input, company: true }),
    onSuccess: invalidate,
  });
}

export function useArchiveRole() {
  const invalidate = useInvalidateRoles();
  return useMutation({
    mutationFn: (id: string) =>
      api.request<void>(`/roles/${id}/archive`, { method: 'POST', company: true }),
    onSuccess: invalidate,
  });
}

export function useRevokeSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.request<void>(`/auth/sessions/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sessions'] }),
  });
}

// ---------- Finanzas: cuentas, categorías y movimientos ----------

export function useAccounts(includeArchived = false) {
  const companyId = useCompanyKey();
  return useQuery({
    queryKey: ['accounts', companyId, includeArchived],
    queryFn: () =>
      api.request<FinancialAccountDto[]>('/accounts', {
        company: true,
        query: { includeArchived: String(includeArchived) },
      }),
    enabled: !!companyId,
  });
}

export function useCategories(includeArchived = false) {
  const companyId = useCompanyKey();
  return useQuery({
    queryKey: ['categories', companyId, includeArchived],
    queryFn: () =>
      api.request<CategoryDto[]>('/categories', {
        company: true,
        query: { includeArchived: String(includeArchived) },
      }),
    enabled: !!companyId,
  });
}

/** Filtros de la lista de movimientos (sin paginación: el cursor lo maneja la consulta). */
export type TransactionFilters = Omit<ListTransactionsQuery, 'limit' | 'cursor'>;

export function useTransactions(filters: TransactionFilters, enabled = true) {
  const companyId = useCompanyKey();
  return useInfiniteQuery({
    queryKey: ['transactions', companyId, filters],
    queryFn: ({ pageParam }) =>
      api.request<TransactionPageDto>('/transactions', {
        company: true,
        query: { ...filters, limit: '30', cursor: pageParam },
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: enabled && !!companyId,
  });
}

export function useTransaction(id: string) {
  const companyId = useCompanyKey();
  return useQuery({
    queryKey: ['transaction', companyId, id],
    queryFn: () => api.request<TransactionDto>(`/transactions/${id}`, { company: true }),
    enabled: !!companyId,
  });
}

/** Un cambio en el dinero afecta saldos, listas de movimientos y el resumen de Inicio. */
function useInvalidateFinance() {
  const qc = useQueryClient();
  return () =>
    Promise.all(
      ['accounts', 'transactions', 'transaction', 'dashboard'].map((key) =>
        qc.invalidateQueries({ queryKey: [key] }),
      ),
    );
}

export function useCreateAccount() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: (input: CreateFinancialAccountInput) =>
      api.request<FinancialAccountDto>('/accounts', { method: 'POST', body: input, company: true }),
    onSuccess: invalidate,
  });
}

export function useUpdateAccount() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: ({ id, ...input }: UpdateFinancialAccountInput & { id: string }) =>
      api.request<FinancialAccountDto>(`/accounts/${id}`, {
        method: 'PATCH',
        body: input,
        company: true,
      }),
    onSuccess: invalidate,
  });
}

export function useArchiveAccount() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: (id: string) =>
      api.request<void>(`/accounts/${id}/archive`, { method: 'POST', company: true }),
    onSuccess: invalidate,
  });
}

function useInvalidateCategories() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ['categories'] });
}

export function useCreateCategory() {
  const invalidate = useInvalidateCategories();
  return useMutation({
    mutationFn: (input: CreateCategoryInput) =>
      api.request<CategoryDto>('/categories', { method: 'POST', body: input, company: true }),
    onSuccess: invalidate,
  });
}

export function useUpdateCategory() {
  const invalidate = useInvalidateCategories();
  return useMutation({
    mutationFn: ({ id, ...input }: UpdateCategoryInput & { id: string }) =>
      api.request<CategoryDto>(`/categories/${id}`, {
        method: 'PATCH',
        body: input,
        company: true,
      }),
    onSuccess: invalidate,
  });
}

export function useArchiveCategory() {
  const invalidate = useInvalidateCategories();
  return useMutation({
    mutationFn: (id: string) =>
      api.request<void>(`/categories/${id}/archive`, { method: 'POST', company: true }),
    onSuccess: invalidate,
  });
}

export function useCreateTransaction() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: (input: CreateTransactionInput) =>
      api.request<TransactionDto>('/transactions', { method: 'POST', body: input, company: true }),
    onSuccess: invalidate,
  });
}

export function useUpdateTransaction() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: ({ id, ...input }: UpdateTransactionInput & { id: string }) =>
      api.request<TransactionDto>(`/transactions/${id}`, {
        method: 'PATCH',
        body: input,
        company: true,
      }),
    onSuccess: invalidate,
  });
}

export function useApproveTransaction() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: (id: string) =>
      api.request<TransactionDto>(`/transactions/${id}/approve`, { method: 'POST', company: true }),
    onSuccess: invalidate,
  });
}

export function useVoidTransaction() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.request<TransactionDto>(`/transactions/${id}/void`, {
        method: 'POST',
        body: { reason },
        company: true,
      }),
    onSuccess: invalidate,
  });
}
