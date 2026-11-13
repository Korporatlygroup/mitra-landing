/** State returned by every form server action (useActionState). */
export interface FormState {
  status: 'idle' | 'error' | 'success';
  /** Key resolved against the full message tree, e.g. "errors.invalid_email" or "members.invited". */
  messageKey?: string;
  /** Non-secret field values to restore after React resets the form. Never contains passwords. */
  values?: Record<string, string>;
  /** Arbitrary non-secret payload for the client (e.g. TOTP enrolment data). */
  data?: Record<string, string>;
}

export const idle: FormState = { status: 'idle' };

export const failure = (errorKey: string, values?: Record<string, string>): FormState => ({
  status: 'error',
  messageKey: `errors.${errorKey}`,
  values,
});

export const success = (messageKey?: string, data?: Record<string, string>): FormState => ({
  status: 'success',
  messageKey,
  data,
});
