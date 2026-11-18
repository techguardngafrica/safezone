import { fieldErrors } from '@safezone/api-client';

export interface FormErrors<K extends string> {
  /** Messages to show under each input. */
  fields: Partial<Record<K, string>>;
  /** Field errors the form has no input for, to list in the summary. */
  other: string[];
}

/**
 * Splits a VALIDATION_FAILED response into per-input messages. `inputs` maps API field paths (as in
 * `visitors.0.phone`) to the form's input keys; anything else lands in `other`.
 */
export function formErrors<K extends string>(
  error: unknown,
  inputs: Record<string, K>,
): FormErrors<K> {
  const fields: Partial<Record<K, string>> = {};
  const other: string[] = [];
  for (const [path, message] of Object.entries(fieldErrors(error))) {
    const key = inputs[path];
    if (key && !fields[key]) fields[key] = message;
    else if (!key) other.push(message);
  }
  return { fields, other };
}
