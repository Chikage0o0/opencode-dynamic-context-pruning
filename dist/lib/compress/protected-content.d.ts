import type { SessionState } from "../state";
import type { SearchContext, SelectionResolution } from "./types";
export declare function appendProtectedUserMessages(summary: string, selection: SelectionResolution, searchContext: SearchContext, state: SessionState, enabled: boolean): string;
export declare function appendProtectedPromptInfo(summary: string, selection: SelectionResolution, searchContext: SearchContext, state: SessionState, enabled: boolean): string;
export declare function extractProtectedPromptInfo(text: string): string[];
export declare function appendProtectedTools(client: any, state: SessionState, allowSubAgents: boolean, summary: string, selection: SelectionResolution, searchContext: SearchContext, protectedTools: string[], protectedFilePatterns?: string[]): Promise<string>;
//# sourceMappingURL=protected-content.d.ts.map