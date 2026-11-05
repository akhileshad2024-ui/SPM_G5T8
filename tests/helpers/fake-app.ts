/**
 * A fake for useApp() (lib/state/app-context.tsx), so a component or page can be rendered
 * without the real provider or the backend. Use it with vi.mock in the test file:
 *
 *   let app = fakeApp();
 *   vi.mock("@/lib/state/app-context", () => ({ useApp: () => app }));
 *   beforeEach(() => { app = fakeApp({ state: { events: [myEvent] } }); });
 *
 * - `state` is merged over an empty, signed-in state, so give only the parts the screen reads.
 * - Every other function on the app is a vi.fn() created on first use, so
 *   `expect(app.assignCoordinator).toHaveBeenCalledWith("E-1", "Priya Tan")` just works.
 *   Give a function a real behaviour by passing it in `overrides`, e.g. `{ event: (id) => ev }`.
 */
import { vi } from "vitest";
import { PEOPLE } from "../../lib/data/seed";
import type { AppApi } from "../../lib/state/app-context";

type State = AppApi["state"];

export function fakeState(overrides: Partial<State> = {}): State {
  return {
    authChecked: true,
    authed: true,
    user: null,
    signInNotice: null,
    role: "coordinator",
    events: [],
    registrations: [],
    coordinators: [],
    safetyChecks: [],
    expiredHolds: [],
    venues: [],
    notifs: [],
    olderNotifs: false,
    selectedId: "",
    tab: "request",
    queueFilter: "action",
    search: "",
    notifsOpen: false,
    toast: null,
    toastKind: "ok",
    modal: null,
    modalText: "",
    step: 1,
    formErrors: {},
    editingEventId: null,
    vf: { cap: "180", layout: "any" },
    form: {
      name: "", purpose: "", eventType: "", date: "", start: "18:00", end: "21:00", pax: "",
      venueLocation: "", venueCapacity: "", layout: "banquet", facilities: [], access: [],
      equip: {}, equipTechnical: {}, reg: true, regCap: "", regClose: "",
    },
    ...overrides,
  } as State;
}

export function fakeApp(overrides: Partial<Omit<AppApi, "state">> & { state?: Partial<State> } = {}): AppApi {
  const { state, ...rest } = overrides;
  const role = state?.role ?? "coordinator";
  const target: Record<string, unknown> = {
    state: fakeState(state),
    me: PEOPLE[role],
    changeRequestPending: false,
    isSavingDraft: false,
    event: () => undefined,
    venue: () => undefined,
    equipName: (id: string) => id,
    freeQty: () => 0,
    reservedQty: () => 0,
    ...rest,
  };
  // Anything not given above becomes a spy the first time a component touches it.
  return new Proxy(target, {
    get(obj, key: string) {
      if (!(key in obj)) obj[key] = vi.fn();
      return obj[key];
    },
  }) as unknown as AppApi;
}
