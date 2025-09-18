/// <reference types="vite/client" />

declare module '*?worker' {
  const WorkerFactory: {
    new (): Worker;
  };
  export default WorkerFactory;
}

declare module 'react-dom/client' {
  import type { ReactNode } from 'react';

  export interface Root {
    render(children: ReactNode): void;
    unmount(): void;
  }

  export function createRoot(
    container: Element | Document | DocumentFragment | Comment,
    options?: {
      identifierPrefix?: string;
      onRecoverableError?: (error: unknown) => void;
    },
  ): Root;
}
