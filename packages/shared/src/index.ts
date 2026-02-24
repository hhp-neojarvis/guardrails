// Shared types and contracts for the Guardrails monorepo.
// API contracts will be added here as features are built.

export interface ApiError {
  error: string;
  message: string;
}

export * from './contracts/meta';
