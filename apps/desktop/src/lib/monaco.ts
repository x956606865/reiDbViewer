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

type MonacoInstance = typeof monaco;

type MonacoEnvironmentConfig = {
  getWorker(workerId: string, label: string): Worker;
};

declare global {
  // eslint-disable-next-line no-var
  var MonacoEnvironment: MonacoEnvironmentConfig | undefined;
}

if (typeof self !== 'undefined') {
  const getWorker = (_: string, label: string) => {
    if (label === 'json') return new jsonWorker();
    if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker();
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new htmlWorker();
    if (label === 'typescript' || label === 'javascript') return new tsWorker();
    return new editorWorker();
  };

  self.MonacoEnvironment = {
    ...(self.MonacoEnvironment ?? {}),
    getWorker,
  } satisfies MonacoEnvironmentConfig;
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
    target: instance.languages.typescript.ScriptTarget.ES2022,
    lib: ['es2022'],
  });
  instance.languages.typescript.javascriptDefaults.setEagerModelSync(true);
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
