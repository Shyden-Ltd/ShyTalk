import { Page } from '@playwright/test';

const API_BASE = process.env.API_BASE_URL || 'https://dev-api.shytalk.shyden.co.uk';
const TEST_API_KEY = process.env.TEST_API_KEY || '';

export interface SetupUserPayload {
  name: string;
  shyCoins?: number;
  shyBeans?: number;
  deviceInfo?: {
    deviceId: string;
    manufacturer: string;
    model: string;
    lastIp: string;
    isp: string;
  };
}

export interface SetupBannerPayload {
  title?: string;
  imageUrl?: string;
  actionType?: string;
  isActive?: boolean;
  sortOrder?: number;
}

export interface SetupFunFactPayload {
  text?: string;
  category?: string;
  emoji?: string;
  sourceLanguage?: string;
  isActive?: boolean;
}

export interface SetupReportPayload {
  reportedUserIndex?: number;
  reporterUserIndex?: number;
  conversationIndex?: number;
  reason?: string;
  status?: string;
}

export interface SetupAppealPayload {
  userIndex?: number;
  appealText?: string;
  status?: string;
}

export interface SetupAlertPayload {
  type?: string;
  severity?: string;
  message?: string;
  status?: string;
}

export interface SetupConversationPayload {
  participants?: string[];
  messages?: Array<{ text: string; senderId: string }>;
}

export interface SetupPayload {
  users?: SetupUserPayload[];
  banners?: SetupBannerPayload[];
  funFacts?: SetupFunFactPayload[];
  reports?: SetupReportPayload[];
  appeals?: SetupAppealPayload[];
  alerts?: SetupAlertPayload[];
  conversations?: SetupConversationPayload[];
}

export interface SetupResult {
  testRunId: string;
  users: Array<{ uid: string; uniqueId: number; displayName: string }>;
  gifts: Array<{ id: string; name: string; coinValue: number }>;
  banners: Array<{ id: string; title: string }>;
  funFacts: Array<{ id: string; text: string }>;
  reports: Array<{ id: string; reportedUserId: string; reporterId: string }>;
  appeals: Array<{ id: string }>;
  alerts: Array<{ id: string }>;
  conversations: Array<{ id: string }>;
  economyConfig: Record<string, any>;
}

export class AdminApi {
  private token: string | null = null;
  private tokenPromise: Promise<string>;
  private resolveToken!: (token: string) => void;

  constructor(private page: Page) {
    this.tokenPromise = new Promise((resolve) => {
      this.resolveToken = resolve;
    });

    // Intercept the first authenticated request to capture the Firebase token
    const handler = (request: any) => {
      const auth = request.headers()['authorization'];
      if (auth?.startsWith('Bearer ')) {
        this.token = auth.slice(7);
        this.resolveToken(this.token);
        page.off('request', handler);
      }
    };
    page.on('request', handler);
  }

  /** Block until the Firebase token is captured (15s deadline) */
  async waitForToken(): Promise<string> {
    return Promise.race([
      this.tokenPromise,
      new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error('Token not captured within 15s — no authenticated API call detected')), 15_000),
      ),
    ]);
  }

  // ── Admin API (Firebase Bearer token) ──

  async get(path: string): Promise<any> {
    const token = await this.tokenPromise;
    const res = await this.page.request.get(`${API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok()) throw new Error(`GET ${path} → ${res.status()}: ${await res.text()}`);
    return res.json();
  }

  async post(path: string, body?: any): Promise<any> {
    const token = await this.tokenPromise;
    const res = await this.page.request.post(`${API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: body,
    });
    if (!res.ok()) throw new Error(`POST ${path} → ${res.status()}: ${await res.text()}`);
    return res.json();
  }

  async patch(path: string, body?: any): Promise<any> {
    const token = await this.tokenPromise;
    const res = await this.page.request.patch(`${API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: body,
    });
    if (!res.ok()) throw new Error(`PATCH ${path} → ${res.status()}: ${await res.text()}`);
    return res.json();
  }

  async delete(path: string): Promise<any> {
    const token = await this.tokenPromise;
    const res = await this.page.request.delete(`${API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok()) throw new Error(`DELETE ${path} → ${res.status()}: ${await res.text()}`);
    return res.json();
  }

  // ── Test Helper API (X-Test-API-Key) ──

  async testSetup(data: SetupPayload): Promise<SetupResult> {
    const res = await this.page.request.post(`${API_BASE}/api/test/setup`, {
      headers: { 'X-Test-API-Key': TEST_API_KEY, 'Content-Type': 'application/json' },
      data,
    });
    if (!res.ok()) throw new Error(`test/setup → ${res.status()}: ${await res.text()}`);
    return res.json();
  }

  async testTeardown(testRunId: string): Promise<void> {
    const res = await this.page.request.post(`${API_BASE}/api/test/teardown`, {
      headers: { 'X-Test-API-Key': TEST_API_KEY, 'Content-Type': 'application/json' },
      data: { testRunId },
    });
    if (!res.ok()) throw new Error(`test/teardown → ${res.status()}: ${await res.text()}`);
  }

  async testVerify(collection: string, docId: string): Promise<any> {
    const res = await this.page.request.get(`${API_BASE}/api/test/verify/${collection}/${docId}`, {
      headers: { 'X-Test-API-Key': TEST_API_KEY },
    });
    if (!res.ok()) throw new Error(`test/verify/${collection}/${docId} → ${res.status()}: ${await res.text()}`);
    return res.json();
  }
}
