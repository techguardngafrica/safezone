import { isAccessTokenExpiring, type SessionStorage } from './index';

/** Minimal user shape the shells need. */
export interface SessionUser {
  id: string;
  phone: string;
  fullName: string | null;
  mfaEnabled: boolean;
}

export interface TokenResult {
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken?: string;
  mfaRequired: boolean;
  mfaEnrolled: boolean;
}

export interface SignInResult extends TokenResult {
  user: SessionUser;
  isNewUser: boolean;
}

/**
 * The calls the controller needs. Apps implement it with @safezone/api-client, passing the access token
 * explicitly, so there is no cycle between the client and the session.
 */
export interface AuthApi {
  requestOtp(phone: string): Promise<{ resendAfterSeconds: number }>;
  verifyOtp(phone: string, code: string): Promise<SignInResult>;
  /** Mobile sends its stored refresh token; web relies on the httpOnly cookie. */
  refresh(refreshToken?: string): Promise<TokenResult>;
  me(accessToken: string): Promise<SessionUser>;
  signOut(accessToken: string): Promise<void>;
  verifyMfa(accessToken: string, input: { code?: string; recoveryCode?: string }): Promise<void>;
  startTotp(accessToken: string): Promise<{ factorId: string; secret: string; otpauthUri: string }>;
  confirmTotp(
    accessToken: string,
    factorId: string,
    code: string,
  ): Promise<{ recoveryCodes: string[] }>;
}

export type SessionStatus =
  | 'restoring'
  | 'signed_out'
  | 'code_sent'
  | 'mfa_verify'
  | 'mfa_enrol'
  | 'recovery_codes'
  | 'signed_in';

export interface SessionState {
  status: SessionStatus;
  phone?: string;
  user?: SessionUser;
  resendAfterSeconds?: number;
  enrolment?: { factorId: string; secret: string; otpauthUri: string };
  recoveryCodes?: string[];
  /** Stable API error code of the last failed action (shown through i18n by the UI). */
  errorCode?: string;
  busy: boolean;
}

/** Errors carrying an API code (ApiClientError from @safezone/api-client matches this shape). */
function codeOf(error: unknown): string {
  return typeof error === 'object' &&
    error !== null &&
    typeof (error as { code?: unknown }).code === 'string'
    ? (error as { code: string }).code
    : 'UNKNOWN';
}

/**
 * Framework-agnostic sign-in state machine shared by all six app shells:
 * signed_out → code_sent → (mfa_enrol → recovery_codes | mfa_verify) → signed_in.
 * React apps read it with useSyncExternalStore(subscribe, getState).
 */
export class SessionController {
  private state: SessionState = { status: 'restoring', busy: false };
  private readonly listeners = new Set<() => void>();
  private accessToken: string | null = null;
  private accessTokenExpiresAt: string | null = null;
  private refreshing: Promise<string | null> | null = null;

  constructor(
    private readonly api: AuthApi,
    private readonly storage: SessionStorage,
    /** Web apps never store a refresh token (it lives in the httpOnly cookie). */
    private readonly keepsRefreshToken: boolean,
  ) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = (): SessionState => this.state;

  /** Restores a previous session on app start. */
  async restore(): Promise<void> {
    const stored = await this.storage.get();
    if (this.keepsRefreshToken && !stored?.refreshToken)
      return this.set({ status: 'signed_out', busy: false });
    try {
      const tokens = await this.api.refresh(stored?.refreshToken);
      await this.acceptTokens(tokens);
      const user = await this.api.me(tokens.accessToken);
      this.set({ status: this.statusAfterTokens(tokens), user, busy: false });
    } catch {
      await this.clear();
    }
  }

  async requestCode(phone: string): Promise<void> {
    await this.run(async () => {
      const result = await this.api.requestOtp(phone);
      this.set({ status: 'code_sent', phone, resendAfterSeconds: result.resendAfterSeconds });
    });
  }

  async verifyCode(code: string): Promise<void> {
    const phone = this.state.phone;
    if (!phone) return;
    await this.run(async () => {
      const result = await this.api.verifyOtp(phone, code);
      await this.acceptTokens(result);
      const status = this.statusAfterTokens(result);
      this.set({ status, user: result.user });
      if (status === 'mfa_enrol') await this.loadEnrolment();
    });
  }

  async verifyMfa(input: { code?: string; recoveryCode?: string }): Promise<void> {
    await this.run(async () => {
      await this.api.verifyMfa(this.requireToken(), input);
      this.set({ status: 'signed_in' });
    });
  }

  async confirmEnrolment(code: string): Promise<void> {
    const factorId = this.state.enrolment?.factorId;
    if (!factorId) return;
    await this.run(async () => {
      const result = await this.api.confirmTotp(this.requireToken(), factorId, code);
      this.set({
        status: 'recovery_codes',
        recoveryCodes: result.recoveryCodes,
        enrolment: undefined,
      });
    });
  }

  /** After the user has saved their recovery codes. */
  finishEnrolment(): void {
    this.set({ status: 'signed_in', recoveryCodes: undefined });
  }

  /** Back to phone entry (wrong number). */
  restart(): void {
    this.set({ status: 'signed_out', phone: undefined, errorCode: undefined, busy: false });
  }

  async signOut(): Promise<void> {
    const token = this.accessToken;
    if (token) await this.api.signOut(token).catch(() => undefined);
    await this.clear();
  }

  /** For the API client: a valid access token, refreshed shortly before expiry. */
  getAccessToken = async (): Promise<string | null> => {
    if (!this.accessToken || !this.accessTokenExpiresAt) return null;
    if (!isAccessTokenExpiring({ accessTokenExpiresAt: this.accessTokenExpiresAt }))
      return this.accessToken;
    this.refreshing ??= this.refreshNow().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  };

  /** For the API client's onUnauthorized hook: the session ended on the server. */
  handleUnauthorized = async (): Promise<void> => {
    if (this.state.status === 'signed_in' || this.state.status === 'mfa_verify') await this.clear();
  };

  private async refreshNow(): Promise<string | null> {
    try {
      const stored = await this.storage.get();
      const tokens = await this.api.refresh(stored?.refreshToken);
      await this.acceptTokens(tokens);
      return tokens.accessToken;
    } catch {
      await this.clear();
      return null;
    }
  }

  private async loadEnrolment(): Promise<void> {
    const enrolment = await this.api.startTotp(this.requireToken());
    this.set({ enrolment });
  }

  private statusAfterTokens(tokens: TokenResult): SessionStatus {
    if (!tokens.mfaRequired) return 'signed_in';
    return tokens.mfaEnrolled ? 'mfa_verify' : 'mfa_enrol';
  }

  private async acceptTokens(tokens: TokenResult): Promise<void> {
    this.accessToken = tokens.accessToken;
    this.accessTokenExpiresAt = tokens.accessTokenExpiresAt;
    const previous = await this.storage.get();
    const refreshToken = this.keepsRefreshToken
      ? (tokens.refreshToken ?? previous?.refreshToken)
      : undefined;
    await this.storage.set({
      accessToken: tokens.accessToken,
      accessTokenExpiresAt: tokens.accessTokenExpiresAt,
      ...(refreshToken ? { refreshToken } : {}),
    });
  }

  private requireToken(): string {
    if (!this.accessToken)
      throw Object.assign(new Error('Not signed in'), { code: 'UNAUTHORIZED' });
    return this.accessToken;
  }

  private async clear(): Promise<void> {
    this.accessToken = null;
    this.accessTokenExpiresAt = null;
    await this.storage.clear();
    this.state = { status: 'signed_out', busy: false };
    this.emit();
  }

  private async run(action: () => Promise<void>): Promise<void> {
    this.set({ busy: true, errorCode: undefined });
    try {
      await action();
      this.set({ busy: false });
    } catch (error) {
      this.set({ busy: false, errorCode: codeOf(error) });
    }
  }

  private set(patch: Partial<SessionState>): void {
    this.state = { ...this.state, ...patch };
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}
