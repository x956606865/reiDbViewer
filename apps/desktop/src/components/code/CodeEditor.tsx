'use client';

import React, {
  Suspense,
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { editor } from 'monaco-editor';
import { Box, Skeleton, Textarea } from '@mantine/core';
import { useMantineColorScheme } from '@mantine/core';
import { ensureMonaco, type MonacoInstance } from '@/lib/monaco';

const MonacoEditor = React.lazy(async () => {
  const mod = await import('@monaco-editor/react');
  return { default: mod.default };
});

type StandaloneEditor = editor.IStandaloneCodeEditor;

type CodeEditorStatus = 'loading' | 'ready' | 'error';

export type CodeEditorOnMount = (
  editorInstance: StandaloneEditor,
  monacoInstance: MonacoInstance,
) => void;

export interface CodeEditorProps {
  value: string;
  language: string;
  onChange: (value: string) => void;
  height?: number | string;
  minHeight?: number | string;
  readOnly?: boolean;
  options?: editor.IStandaloneEditorConstructionOptions;
  beforeMount?: (monacoInstance: MonacoInstance) => void;
  onMount?: CodeEditorOnMount;
  ariaLabel?: string;
  className?: string;
  fallbackEditable?: boolean;
  modelPath?: string;
  placeholder?: string;
}

export const CodeEditor = forwardRef<StandaloneEditor | null, CodeEditorProps>(
  (
    {
      value,
      language,
      onChange,
      height = 260,
      minHeight,
      readOnly = false,
      options,
      beforeMount,
      onMount,
      ariaLabel,
      className,
      fallbackEditable = true,
      modelPath,
      placeholder,
    },
    ref,
  ) => {
    const { colorScheme } = useMantineColorScheme();
    const [status, setStatus] = useState<CodeEditorStatus>('loading');

    useEffect(() => {
      let mounted = true;
      ensureMonaco()
        .then(() => {
          if (!mounted) return;
          setStatus('ready');
        })
        .catch(() => {
          if (!mounted) return;
          setStatus('error');
        });
      return () => {
        mounted = false;
      };
    }, []);

    const editorOptions = useMemo<editor.IStandaloneEditorConstructionOptions>(() => {
      const merged: editor.IStandaloneEditorConstructionOptions = {
        fontFamily: 'var(--mantine-font-family-monospace)',
        fontSize: 13,
        minimap: { enabled: false },
        automaticLayout: true,
        scrollBeyondLastLine: false,
        wordWrap: 'on',
        readOnly,
        quickSuggestions: true,
        folding: true,
        renderValidationDecorations: 'on',
        fixedOverflowWidgets: true,
        ...options,
      };
      merged.readOnly = options?.readOnly ?? readOnly;
      if (merged.placeholder === undefined && placeholder) {
        merged.placeholder = placeholder;
      }
      return merged;
    }, [options, placeholder, readOnly]);

    const resolvedReadOnly = editorOptions.readOnly ?? false;

    const handleFallbackChange = useCallback(
      (event: React.ChangeEvent<HTMLTextAreaElement>) => {
        if (resolvedReadOnly) return;
        onChange(event.currentTarget.value);
      },
      [onChange, resolvedReadOnly],
    );

    const handleChange = useCallback(
      (nextValue: string | undefined) => {
        onChange(nextValue ?? '');
      },
      [onChange],
    );

    const handleMount = useCallback<CodeEditorOnMount>(
      (instance, monacoInstance) => {
        if (typeof ref === 'function') {
          ref(instance);
        } else if (ref) {
          ref.current = instance;
        }
        onMount?.(instance, monacoInstance);
      },
      [onMount, ref],
    );

    if (status === 'loading') {
      return (
        <Skeleton
          height={typeof height === 'number' ? height : undefined}
          className={className}
          mt={0}
        />
      );
    }

    if (status === 'error' && fallbackEditable) {
      return (
        <Textarea
          value={value}
          onChange={handleFallbackChange}
          autosize
          minRows={8}
          className={className}
          styles={{ input: { fontFamily: 'var(--mantine-font-family-monospace)' } }}
          readOnly={resolvedReadOnly}
          aria-label={ariaLabel}
          placeholder={placeholder}
        />
      );
    }

    if (status === 'error') {
      return null;
    }

    const currentTheme = colorScheme === 'dark' ? 'vs-dark' : 'vs';

    return (
      <Box className={className} style={{ height, minHeight }}>
        <Suspense fallback={<Skeleton height="100%" />}>
          <MonacoEditor
            language={language}
            value={value}
            onChange={handleChange}
            theme={currentTheme}
            options={editorOptions}
            onMount={handleMount}
            beforeMount={beforeMount}
            loading={<Skeleton height="100%" />}
            height="100%"
            path={modelPath}
            aria-label={ariaLabel}
          />
        </Suspense>
      </Box>
    );
  },
);

CodeEditor.displayName = 'CodeEditor';
