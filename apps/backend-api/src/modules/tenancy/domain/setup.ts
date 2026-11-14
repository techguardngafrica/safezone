/** Setup wizard steps (tenancy.md §4.1 step 6, §7.4). `residents` is optional. */
export const SETUP_STEPS = [
  'profile',
  'spaces',
  'gates',
  'security_supervisor',
  'sos_policy',
  'residents',
] as const;
export type SetupStep = (typeof SETUP_STEPS)[number];

/** Steps that must be complete before the estate can go active. */
export const REQUIRED_SETUP_STEPS: readonly SetupStep[] = [
  'spaces',
  'gates',
  'security_supervisor',
  'sos_policy',
];

export function missingSetupSteps(completed: ReadonlySet<string>): SetupStep[] {
  return REQUIRED_SETUP_STEPS.filter((step) => !completed.has(step));
}
