import { useCallback } from 'react';
import type { JSX, ChangeEvent } from 'react';

interface FieldProps<T> {
  label: string;
  description?: string;
  value: T;
  onChange: (value: T) => void;
}

interface TextFieldProps extends FieldProps<string> {
  multiline?: boolean;
  placeholder?: string;
}

const inputClasses: string = `
  w-full rounded-md border border-border bg-background
  px-2.5 py-1.5 font-mono text-sm text-foreground
  placeholder:text-muted-foreground/50
  focus:outline-none focus:ring-1 focus:ring-ring
  transition-colors
`;

export function TextField({ label, description, value, onChange, multiline, placeholder }: TextFieldProps): JSX.Element {
  const handleChange: (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void = useCallback(
    (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      onChange(e.target.value);
    },
    [onChange],
  );

  return (
    <div className="flex flex-col gap-1.5 py-1.5 px-1">
      <div className="flex flex-col gap-0.5">
        <span className="font-mono text-sm text-foreground">{label}</span>
        {description && (
          <span className="text-muted-foreground text-xs">{description}</span>
        )}
      </div>
      {multiline ? (
        <textarea
          value={value}
          onChange={handleChange}
          placeholder={placeholder}
          rows={3}
          className={`${inputClasses} resize-y min-h-[60px]`}
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={handleChange}
          placeholder={placeholder}
          className={inputClasses}
        />
      )}
    </div>
  );
}
