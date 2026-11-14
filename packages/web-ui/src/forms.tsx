import { type ReactNode, useId } from 'react';

interface FieldShellProps {
  label: string;
  helper?: string;
  error?: string | null;
  required?: boolean;
}

function describedBy(id: string, props: FieldShellProps): string | undefined {
  if (props.error) return `${id}-error`;
  if (props.helper) return `${id}-helper`;
  return undefined;
}

function FieldMeta({ id, helper, error }: { id: string; helper?: string; error?: string | null }) {
  if (error)
    return (
      <span id={`${id}-error`} className="sz-error" role="alert">
        {error}
      </span>
    );
  if (helper) return <small id={`${id}-helper`}>{helper}</small>;
  return null;
}

export interface InputFieldProps extends FieldShellProps {
  value: string;
  onChange: (value: string) => void;
  type?: 'text' | 'search' | 'number' | 'date' | 'datetime-local' | 'tel' | 'email';
  placeholder?: string;
  autoFocus?: boolean;
  min?: number | string;
  max?: number | string;
  maxLength?: number;
  inputMode?: 'text' | 'numeric' | 'decimal' | 'tel' | 'search';
}

export function InputField(props: InputFieldProps) {
  const id = useId();
  return (
    <div className="sz-field">
      <label htmlFor={id}>{props.label}</label>
      <input
        id={id}
        className="sz-input"
        type={props.type ?? 'text'}
        value={props.value}
        placeholder={props.placeholder}
        onChange={(event) => props.onChange(event.target.value)}
        aria-invalid={props.error ? true : undefined}
        aria-describedby={describedBy(id, props)}
        required={props.required}
        autoFocus={props.autoFocus}
        min={props.min}
        max={props.max}
        maxLength={props.maxLength}
        inputMode={props.inputMode}
      />
      <FieldMeta id={id} helper={props.helper} error={props.error} />
    </div>
  );
}

export interface SelectFieldProps<V extends string> extends FieldShellProps {
  value: V;
  onChange: (value: V) => void;
  options: { value: V; label: string }[];
}

export function SelectField<V extends string>(props: SelectFieldProps<V>) {
  const id = useId();
  return (
    <div className="sz-field">
      <label htmlFor={id}>{props.label}</label>
      <select
        id={id}
        className="sz-input"
        value={props.value}
        onChange={(event) => props.onChange(event.target.value as V)}
        aria-invalid={props.error ? true : undefined}
        aria-describedby={describedBy(id, props)}
        required={props.required}
      >
        {props.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <FieldMeta id={id} helper={props.helper} error={props.error} />
    </div>
  );
}

export interface TextAreaFieldProps extends FieldShellProps {
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  autoFocus?: boolean;
  maxLength?: number;
}

export function TextAreaField(props: TextAreaFieldProps) {
  const id = useId();
  return (
    <div className="sz-field">
      <label htmlFor={id}>{props.label}</label>
      <textarea
        id={id}
        className="sz-input"
        value={props.value}
        rows={props.rows ?? 4}
        onChange={(event) => props.onChange(event.target.value)}
        aria-invalid={props.error ? true : undefined}
        aria-describedby={describedBy(id, props)}
        required={props.required}
        autoFocus={props.autoFocus}
        maxLength={props.maxLength}
      />
      <FieldMeta id={id} helper={props.helper} error={props.error} />
    </div>
  );
}

export function CheckboxField({
  label,
  checked,
  onChange,
  helper,
}: {
  label: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  helper?: string;
}) {
  const id = useId();
  return (
    <div className="sz-field">
      <label className="sz-check" htmlFor={id}>
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span>{label}</span>
      </label>
      {helper ? <small>{helper}</small> : null}
    </div>
  );
}

export function FormError({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="sz-error" style={{ margin: 0 }}>
      {message}
    </p>
  );
}
