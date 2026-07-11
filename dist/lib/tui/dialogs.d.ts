/** @jsxImportSource @opentui/solid */
import type { PluginConfig } from "../config";
import type { SessionState, WithParts } from "../state";
import type { StatsReport, TuiApi } from "./types";
export declare function StatusDialog(props: {
    api: TuiApi;
    title: string;
    eyebrow: string;
    message: string;
}): any;
export declare function ContextDialog(props: {
    api: TuiApi;
    state: SessionState;
    messages: WithParts[];
    onBack: () => void;
}): any;
export declare function StatsDialog(props: {
    api: TuiApi;
    report: StatsReport;
    onBack: () => void;
}): any;
export declare function PanelDialog(props: {
    api: TuiApi;
    state: SessionState;
    config: PluginConfig;
    onContext: () => void;
    onStats: () => void;
    onManual: (enabled: boolean) => void;
}): any;
//# sourceMappingURL=dialogs.d.ts.map