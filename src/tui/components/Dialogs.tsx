import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

export interface FormField {
  key: string;
  label: string;
  placeholder?: string;
  initialValue?: string;
  description?: string;
  required?: boolean;
  secret?: boolean;
}

export type FormValues = Record<string, string>;

interface FormDialogProps {
  title: string;
  description?: string;
  fields: FormField[];
  submitLabel: string;
  onSubmit: (values: FormValues) => Promise<void>;
  onComplete: () => void;
  onCancel: () => void;
}

function initialValues(fields: FormField[]): FormValues {
  return Object.fromEntries(fields.map(field => [field.key, field.initialValue ?? '']));
}

function printableInput(input: string): string {
  return input.replace(/\r/g, '').replace(/[^\x20-\x7E\n\t]/g, '');
}

export function FormDialog({
  title,
  description,
  fields,
  submitLabel,
  onSubmit,
  onComplete,
  onCancel,
}: FormDialogProps) {
  const [values, setValues] = useState<FormValues>(() => initialValues(fields));
  const [replaceOnInput, setReplaceOnInput] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(fields.map(field => [field.key, field.initialValue !== undefined]))
  );

  const [fieldIndex, setFieldIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    const missing = fields.find(field => field.required && !values[field.key].trim());
    if (missing) {
      setError(`${missing.label} is required.`);
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(values);
      onComplete();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setSubmitting(false);
    }
  };

  useInput(
    (input, key) => {
      if (submitting) return;

      if (key.escape) {
        onCancel();
        return;
      }

      const activeField = fields[fieldIndex];
      if ((key.ctrl && (input === 'a' || input === 'u')) || input === '\x01' || input === '\x15') {
        setValues(current => ({ ...current, [activeField.key]: '' }));
        setReplaceOnInput(current => ({ ...current, [activeField.key]: false }));
        return;
      }

      if (key.upArrow || (key.tab && key.shift)) {
        setFieldIndex(current => (current - 1 + fields.length) % fields.length);
        return;
      }

      if ((key.tab && !key.shift) || key.downArrow) {
        setFieldIndex(current => (current + 1) % fields.length);
        return;
      }

      if (key.return) {
        if (fieldIndex < fields.length - 1) {
          setFieldIndex(current => current + 1);
        } else {
          void submit();
        }
        return;
      }

      if (key.backspace || key.delete) {
        setValues(current => ({
          ...current,
          [activeField.key]: replaceOnInput[activeField.key] ? '' : current[activeField.key].slice(0, -1),
        }));
        setReplaceOnInput(current => ({ ...current, [activeField.key]: false }));
        return;
      }

      const text = printableInput(input);
      if (text && !key.ctrl && !key.meta) {
        setValues(current => ({
          ...current,
          [activeField.key]: replaceOnInput[activeField.key] ? text : current[activeField.key] + text,
        }));
        setReplaceOnInput(current => ({ ...current, [activeField.key]: false }));
      }
    },
    { isActive: !submitting }
  );

  return (
    <Box borderStyle="round" borderColor="cyan" flexDirection="column" paddingX={1} width="100%">
      <Text bold color="cyan">
        {title}
      </Text>
      {description && <Text dimColor>{description}</Text>}

      <Box flexDirection="column" marginTop={1}>
        {fields.map((field, index) => {
          const focused = index === fieldIndex;
          const value = values[field.key];
          const displayed = field.secret ? '*'.repeat(value.length) : value;
          return (
            <Box flexDirection="column" key={field.key} marginBottom={1}>
              <Text bold={focused} color={focused ? 'cyan' : undefined}>
                {focused ? '> ' : '  '}
                {field.label}
                {field.required ? ' *' : ''}
              </Text>
              <Box borderStyle="single" borderColor={focused ? 'cyan' : 'gray'} paddingX={1} width="100%">
                <Text color={displayed ? undefined : 'gray'}>
                  {displayed || field.placeholder || ''}
                  {focused ? '_' : ''}
                </Text>
              </Box>
              {focused && replaceOnInput[field.key] && value && <Text dimColor>Typing replaces the current value.</Text>}
              {field.description && <Text dimColor>{field.description}</Text>}
            </Box>
          );
        })}
      </Box>

      {error && <Text color="red">Error: {error}</Text>}
      {submitting && <Text color="yellow">{submitLabel}…</Text>}
      <Text dimColor>
        Tab / arrows move · Ctrl+A clear field · Enter {fieldIndex === fields.length - 1 ? submitLabel.toLowerCase() : 'next field'} · Esc cancel
      </Text>
    </Box>
  );
}

interface ConfirmDialogProps {
  title: string;
  detail: string;
  confirmation: string;
  confirmLabel: string;
  onConfirm: () => Promise<void>;
  onComplete: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  title,
  detail,
  confirmation,
  confirmLabel,
  onConfirm,
  onComplete,
  onCancel,
}: ConfirmDialogProps) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (value !== confirmation) {
      setError(`Type ${confirmation} to continue.`);
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await onConfirm();
      onComplete();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setSubmitting(false);
    }
  };

  useInput(
    (input, key) => {
      if (submitting) return;
      if (key.escape) {
        onCancel();
        return;
      }
      if (key.return) {
        void submit();
        return;
      }
      if (key.backspace || key.delete) {
        setValue(current => current.slice(0, -1));
        return;
      }
      const text = printableInput(input);
      if (text && !key.ctrl && !key.meta) {
        setValue(current => current + text);
      }
    },
    { isActive: !submitting }
  );

  return (
    <Box borderStyle="round" borderColor="red" flexDirection="column" paddingX={1} width="100%">
      <Text bold color="red">
        {title}
      </Text>
      <Text>{detail}</Text>
      <Box marginTop={1}>
        <Text>Type </Text>
        <Text bold color="yellow">
          {confirmation}
        </Text>
        <Text> to {confirmLabel.toLowerCase()}.</Text>
      </Box>
      <Box borderStyle="single" borderColor="red" marginY={1} paddingX={1} width="100%">
        <Text>{value}_</Text>
      </Box>
      {error && <Text color="red">Error: {error}</Text>}
      {submitting && <Text color="yellow">{confirmLabel}…</Text>}
      <Text dimColor>Enter confirm · Esc cancel</Text>
    </Box>
  );
}
