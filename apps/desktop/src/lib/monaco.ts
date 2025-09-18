import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';
import 'monaco-editor/esm/vs/basic-languages/sql/sql.contribution';
import 'monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution';
import 'monaco-editor/esm/vs/language/json/monaco.contribution';
import 'monaco-editor/esm/vs/language/typescript/monaco.contribution';
import { initializeSqlCompletion } from '@/lib/sql-completion';

type MonacoInstance = typeof monaco;

type MonacoEnvironmentConfig = {
  getWorker(workerId: string, label: string): Worker;
};

if (typeof self !== 'undefined') {
  const scope = self as typeof self & { MonacoEnvironment?: MonacoEnvironmentConfig };
  const getWorker = (_: string, label: string) => {
    if (label === 'json') return new jsonWorker();
    if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker();
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new htmlWorker();
    if (label === 'typescript' || label === 'javascript') return new tsWorker();
    return new editorWorker();
  };

  scope.MonacoEnvironment = {
    ...(scope.MonacoEnvironment ?? {}),
    getWorker,
  };
}

loader.config({ monaco });

let initPromise: Promise<MonacoInstance> | null = null;

function configureMonaco(instance: MonacoInstance) {
  instance.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: false,
    noSyntaxValidation: false,
  });
  instance.languages.typescript.javascriptDefaults.setCompilerOptions({
    allowNonTsExtensions: true,
    target: instance.languages.typescript.ScriptTarget.ESNext,
    lib: ['es2022'],
  });
  instance.languages.typescript.javascriptDefaults.setEagerModelSync(true);
  initializeSqlCompletion(instance);
}

export async function ensureMonaco(): Promise<MonacoInstance> {
  if (!initPromise) {
    initPromise = loader
      .init()
      .then((instance) => {
        configureMonaco(instance);
        return instance;
      })
      .catch((error) => {
        initPromise = null;
        throw error;
      });
  }
  return initPromise;
}

export type { MonacoInstance };
export { monaco };
