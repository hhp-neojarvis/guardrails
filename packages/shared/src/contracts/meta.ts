export interface MetaAuthUrlResponse {
  url: string;
}

export interface MetaAdAccount {
  id: string;
  metaAccountId: string; // e.g. "act_123456789"
  metaAccountName: string;
  connectedByEmail: string;
  connectedAt: string;
  tokenStatus: 'valid' | 'expired' | 'error';
}

export interface ListMetaAccountsResponse {
  accounts: MetaAdAccount[];
}

export interface DisconnectMetaAccountResponse {
  success: boolean;
}

export interface MetaCallbackQuery {
  code: string;
  state: string;
}
