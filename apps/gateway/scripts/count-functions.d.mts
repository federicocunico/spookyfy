export declare const MAX_FUNCTIONS: number;
export declare function listFunctions(apiDir: string): string[];
export declare function checkFunctions(
  apiDir: string,
  max?: number,
): { ok: boolean; count: number; max: number; functions: string[] };
